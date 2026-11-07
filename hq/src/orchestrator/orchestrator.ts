// What happens next. Reacts to company events by queueing the right agent run,
// executes runs, and turns each run's outcome into the next status. No agent decides
// any of this; agents only act through the Company rules during their run.
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/db.ts';
import * as tasksRepo from '../db/repos/tasks.ts';
import * as projectsRepo from '../db/repos/projects.ts';
import * as runsRepo from '../db/repos/runs.ts';
import * as approvalsRepo from '../db/repos/approvals.ts';
import * as crossTeamRepo from '../db/repos/crossTeam.ts';
import * as chatRepo from '../db/repos/chat.ts';
import * as kv from '../db/repos/kv.ts';
import type { CompanyEvent, EventBus } from '../events/bus.ts';
import type { CallerCtx, Company } from '../domain/company.ts';
import { isTerminal } from '../domain/lifecycle.ts';
import { BOARD_COLUMNS } from '../domain/lifecycle.ts';
import type { Workspaces } from '../workspace/workspaces.ts';
import { getAgent } from '../org/roster.ts';
import { taskPrompt, type PromptCtx } from '../runner/prompts.ts';
import type { AgentRunner, RunOutcome, StreamEvent } from '../runner/types.ts';
import type { Config } from '../config.ts';
import type { Phase, Project, Run, RunPurpose, Task } from '../types.ts';
import type { RunQueue } from './queue.ts';
import type { TokenRegistry } from './tokens.ts';

export interface OrchestratorDeps {
  db: Db;
  bus: EventBus;
  company: Company;
  queue: RunQueue;
  ws: Workspaces;
  tokens: TokenRegistry;
  runner: AgentRunner;
  config: Config;
  now: () => Date;
}

const CEO_SESSION_KEY = 'ceo_session_id';
const DEFAULT_PAUSE_MS = 30 * 60 * 1000;

export class Orchestrator {
  private readonly d: OrchestratorDeps;
  private readonly inflight = new Set<Promise<void>>();
  private resumeTimer: NodeJS.Timeout | null = null;

  constructor(deps: OrchestratorDeps) {
    this.d = deps;
  }

  start(): void {
    this.d.bus.on(e => this.onEvent(e));
    this.pump();
  }

  /** Start every run the queue allows right now. */
  pump(): void {
    const { queue } = this.d;
    if (!queue.isPaused() && queue.pausedUntil()) queue.resume();
    for (const run of queue.nextStartable()) {
      const started = runsRepo.update(this.d.db, run.id, { status: 'running', startedAt: this.d.now().toISOString() });
      this.d.bus.emit({ type: 'run.updated', run: started });
      const p: Promise<void> = this.execute(started)
        .catch(err => this.failRun(started, err instanceof Error ? err.message : String(err)))
        .finally(() => { this.inflight.delete(p); this.pump(); });
      this.inflight.add(p);
    }
  }

  /** Resolves once nothing is running and nothing can start. */
  async idle(): Promise<void> {
    while (this.inflight.size > 0 || this.d.queue.nextStartable().length > 0) {
      if (this.inflight.size === 0) this.pump();
      if (this.inflight.size > 0) await Promise.race([...this.inflight]);
    }
  }

  // ---------- event rules ----------

  private onEvent(e: CompanyEvent): void {
    const { db, company } = this.d;
    switch (e.type) {
      case 'project.updated': {
        if (!e.prev || e.prev === e.project.status) return;
        const p = e.project;
        if (p.status === 'conception') {
          company.hqCreatePhaseTask({
            projectId: p.id, phase: 'conception', assigneeId: 'chief-architect', assignedById: 'ceo', attachAbs: [],
            title: `Design: ${p.title}`,
            instructions: `Produce the design for this project: architecture, scope and a clear cahier des charges.\n\nBrief:\n${p.brief}`,
          });
        } else if (p.status === 'in_progress') {
          this.enqueue({ agentId: 'ceo', purpose: 'plan_delivery', projectId: p.id });
        }
        return;
      }
      case 'task.created':
        if (e.task.status === 'queued') this.enqueueTaskRun(e.task);
        return;
      case 'task.updated': {
        const t = e.task;
        if (t.status === 'queued' || t.status === 'rework') this.enqueueTaskRun(t);
        else if (t.status === 'in_review') this.enqueue({ agentId: t.assignedById, purpose: 'review', projectId: t.projectId, payload: { reviewTaskId: t.id } });
        else if (t.status === 'done' || t.status === 'failed') this.afterTaskFinished(t);
        return;
      }
      case 'approval.created':
        this.enqueue({ agentId: 'ceo', purpose: 'recommend', projectId: e.approval.projectId, payload: { approvalId: e.approval.id } });
        return;
      case 'crossteam.created':
        this.enqueue({ agentId: 'ceo', purpose: 'triage', projectId: e.request.projectId, payload: { crossTeamRequestId: e.request.id } });
        return;
      default:
        void db;
    }
  }

  private enqueue(r: { agentId: string; purpose: RunPurpose; taskId?: string; projectId?: string; payload?: Record<string, unknown> }): void {
    this.d.queue.enqueue(r);
    queueMicrotask(() => this.pump());
  }

  private enqueueTaskRun(t: Task): void {
    const children = tasksRepo.listChildren(this.d.db, t.id);
    const purpose: RunPurpose = children.length > 0 && children.every(c => isTerminal(c.status)) ? 'compile' : 'work';
    this.enqueue({ agentId: t.assigneeId, purpose, taskId: t.id, projectId: t.projectId });
  }

  private afterTaskFinished(t: Task): void {
    const { db, company } = this.d;
    if (t.parentId) {
      const parent = tasksRepo.get(db, t.parentId)!;
      const siblings = tasksRepo.listChildren(db, parent.id);
      if (parent.status === 'waiting_subtasks' && siblings.every(s => isTerminal(s.status))) {
        company.hqSetTaskStatus(parent.id, 'running');
        this.enqueue({ agentId: parent.assigneeId, purpose: 'compile', taskId: parent.id, projectId: parent.projectId });
      }
      return;
    }
    if (t.status !== 'done') return;
    const project = projectsRepo.get(db, t.projectId)!;
    const top = (phase: Phase) => tasksRepo.listByProject(db, project.id).filter(x => x.parentId === null && x.phase === phase);
    const phaseDone = (phase: Phase) => top(phase).length > 0 && top(phase).every(x => isTerminal(x.status)) && top(phase).some(x => x.status === 'done');

    if (t.phase === 'conception' && project.status === 'conception' && phaseDone('conception')) {
      company.hqSetProjectStatus(project.id, 'budgeting');
      company.hqCreatePhaseTask({
        projectId: project.id, phase: 'budgeting', assigneeId: 'cfo', assignedById: 'ceo',
        title: `Budget: ${project.title}`,
        instructions: `Budget this project from the design in your inbox: effort per team, AI usage, external costs (TND, EUR or USD), and the client price if it is client work. Record it with set_budget, then submit your budget file.\n\nBrief:\n${project.brief}`,
        attachAbs: this.phaseFiles(project.id, ['conception']),
      });
    } else if (t.phase === 'budgeting' && project.status === 'budgeting' && phaseDone('budgeting')) {
      company.hqSetProjectStatus(project.id, 'awaiting_approval');
    } else if (t.phase === 'delivery' && project.status === 'in_progress' && top('delivery').every(x => isTerminal(x.status))) {
      const openReport = top('report').some(x => !isTerminal(x.status));
      if (!openReport) {
        company.hqCreatePhaseTask({
          projectId: project.id, phase: 'report', assigneeId: 'ceo', assignedById: 'ceo',
          title: `Final report: ${project.title}`,
          instructions: 'Write the final report for the founder: what was delivered, by whom, open issues, and the deliverable files that matter. Attach the key files in your result.',
          attachAbs: this.phaseFiles(project.id, ['conception', 'budgeting', 'delivery']),
        });
      }
    }
  }

  private phaseFiles(projectId: string, phases: Phase[]): string[] {
    const files = tasksRepo.listByProject(this.d.db, projectId)
      .filter(x => phases.includes(x.phase) && x.status === 'done')
      .flatMap(x => x.resultFiles);
    return [...new Set(files)];
  }

  // ---------- running ----------

  private async execute(run: Run): Promise<void> {
    const { db, ws, tokens, runner, config, company } = this.d;
    const agent = getAgent(run.agentId);
    ws.ensure(agent.id);
    const task = run.taskId ? tasksRepo.get(db, run.taskId) : null;
    const project = run.projectId ? projectsRepo.get(db, run.projectId) : null;

    if (task) {
      if (run.purpose === 'work' && (task.status === 'queued' || task.status === 'rework')) company.hqSetTaskStatus(task.id, 'running');
      else if (run.purpose === 'compile' && task.status === 'queued') company.hqSetTaskStatus(task.id, 'running');
      else if (task.status !== 'running') return this.finishRun(run, 'failed', 0, null, `stale: task is ${task.status}`);
    }

    const ctx: PromptCtx = { inboxFiles: [], project: project ?? undefined };
    const payload = run.payload;
    switch (run.purpose) {
      case 'work': {
        const t = tasksRepo.get(db, task!.id)!;
        ctx.task = t;
        ctx.inboxFiles = ws.deliverInbox(agent.id, t.id, t.attachments);
        break;
      }
      case 'compile': {
        const t = tasksRepo.get(db, task!.id)!;
        ctx.task = t;
        ctx.subtasks = tasksRepo.listChildren(db, t.id);
        ctx.inboxFiles = ws.deliverInbox(agent.id, `${t.id}-results`, ctx.subtasks.flatMap(s => s.resultFiles));
        break;
      }
      case 'review': {
        const reviewed = tasksRepo.get(db, String(payload.reviewTaskId))!;
        if (reviewed.status !== 'in_review') return this.finishRun(run, 'failed', 0, null, `stale: task is ${reviewed.status}`);
        const files = ws.deliverInbox(agent.id, `review-${reviewed.id}`, reviewed.resultFiles);
        ctx.reviewOf = { task: reviewed, submitterTitle: getAgent(reviewed.assigneeId).title, files };
        break;
      }
      case 'plan_delivery':
        ctx.inboxFiles = ws.deliverInbox(agent.id, `plan-${project!.id}`, this.phaseFiles(project!.id, ['conception', 'budgeting']));
        break;
      case 'recommend':
        ctx.approval = approvalsRepo.get(db, String(payload.approvalId)) ?? undefined;
        if (!ctx.approval || ctx.approval.status !== 'pending') return this.finishRun(run, 'failed', 0, null, 'stale: approval already decided');
        break;
      case 'triage':
        ctx.crossTeam = crossTeamRepo.get(db, String(payload.crossTeamRequestId)) ?? undefined;
        if (!ctx.crossTeam || ctx.crossTeam.status !== 'open') return this.finishRun(run, 'failed', 0, null, 'stale: request already handled');
        break;
      case 'chat':
        ctx.founderMessage = String(payload.text ?? '');
        ctx.boardSummary = this.boardSummary();
        break;
    }

    let session: { id: string; resume: boolean } | null = null;
    if (run.purpose === 'chat') {
      const existing = kv.get(db, CEO_SESSION_KEY);
      session = existing ? { id: existing, resume: true } : { id: randomUUID(), resume: false };
    }

    const caller: CallerCtx = {
      agentId: agent.id, runId: run.id, taskId: run.taskId, projectId: run.projectId, purpose: run.purpose,
      crossTeamRequestId: typeof payload.crossTeamRequestId === 'string' ? payload.crossTeamRequestId : null,
    };
    const token = tokens.mint(caller);
    const createdBefore = this.topLevelDeliveryCount(run.projectId);
    let outcome: RunOutcome;
    try {
      outcome = await runner.run({
        runId: run.id, agent, purpose: run.purpose, prompt: taskPrompt(run.purpose, ctx), cwd: ws.dirOf(agent.id),
        model: agent.role === 'ceo' ? config.ceoModel : config.model, token, session,
      }, (e: StreamEvent) => {
        if (e.kind === 'tool_use') this.d.bus.emit({ type: 'run.activity', runId: run.id, agentId: agent.id, tool: e.tool });
      });
    } finally {
      tokens.revoke(token);
    }

    if (outcome.usageLimit) return this.onUsageLimit(run, outcome);
    this.finishRun(run, outcome.ok ? 'succeeded' : 'failed', outcome.costUsd, outcome.sessionId, outcome.error);
    if (run.purpose === 'chat') return this.afterChat(session!, outcome);
    if (!outcome.ok) return this.afterFailedRun(run, outcome.error ?? 'run failed');
    this.afterSucceededRun(run, createdBefore);
  }

  private afterSucceededRun(run: Run, deliveryBefore: number): void {
    const { db, company } = this.d;
    if ((run.purpose === 'work' || run.purpose === 'compile') && run.taskId) {
      const t = tasksRepo.get(db, run.taskId)!;
      if (t.status !== 'running') return;
      const children = tasksRepo.listChildren(db, t.id);
      if (run.purpose === 'work' && children.length > 0) {
        if (children.every(c => isTerminal(c.status))) this.enqueue({ agentId: t.assigneeId, purpose: 'compile', taskId: t.id, projectId: t.projectId });
        else company.hqSetTaskStatus(t.id, 'waiting_subtasks');
        return;
      }
      this.failTask(t, 'ended without submit_result');
    } else if (run.purpose === 'review') {
      const reviewed = tasksRepo.get(db, String(run.payload.reviewTaskId))!;
      if (reviewed.status !== 'in_review') return;
      if (run.payload.retry) this.block(reviewed.projectId, `${getAgent(run.agentId).title} did not review "${reviewed.title}"`);
      else this.enqueue({ agentId: run.agentId, purpose: 'review', projectId: run.projectId ?? undefined, payload: { ...run.payload, retry: 1 } });
    } else if (run.purpose === 'plan_delivery' && run.projectId) {
      if (this.topLevelDeliveryCount(run.projectId) === deliveryBefore) this.block(run.projectId, 'CEO assigned no work');
    }
  }

  private afterFailedRun(run: Run, error: string): void {
    const { db } = this.d;
    if (run.taskId) {
      const t = tasksRepo.get(db, run.taskId)!;
      if (t.status === 'running') this.failTask(t, error);
    } else if (run.purpose === 'plan_delivery' && run.projectId) {
      this.block(run.projectId, `Delivery planning failed: ${error}`);
    } else if (run.purpose === 'review' && run.projectId) {
      this.block(run.projectId, `Review failed: ${error}`);
    }
  }

  private afterChat(session: { id: string; resume: boolean }, outcome: RunOutcome): void {
    const { db, bus } = this.d;
    if (outcome.ok) {
      kv.set(db, CEO_SESSION_KEY, outcome.sessionId || session.id);
      const msg = chatRepo.append(db, 'ceo', outcome.finalText || '(no reply)');
      bus.emit({ type: 'chat.message', message: msg });
    } else {
      if (session.resume) kv.set(db, CEO_SESSION_KEY, null);
      const msg = chatRepo.append(db, 'ceo', `I could not reply: ${outcome.error ?? 'unknown error'}. Please send your message again.`);
      bus.emit({ type: 'chat.message', message: msg });
    }
  }

  private onUsageLimit(run: Run, outcome: RunOutcome): void {
    const { db, company, queue, now } = this.d;
    this.finishRun(run, 'paused', outcome.costUsd, outcome.sessionId, outcome.error ?? 'usage limit reached');
    const until = outcome.usageLimit!.resetAt ?? new Date(now().getTime() + DEFAULT_PAUSE_MS);
    queue.pause(until);
    const t = run.taskId ? tasksRepo.get(db, run.taskId) : null;
    if (t && t.status === 'running') company.hqSetTaskStatus(t.id, 'queued');
    else if (!t) this.enqueue({ agentId: run.agentId, purpose: run.purpose, projectId: run.projectId ?? undefined, payload: run.payload });
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => { this.resumeTimer = null; this.pump(); }, Math.max(0, until.getTime() - Date.now()) + 1000);
    this.resumeTimer.unref();
  }

  private failRun(run: Run, error: string): void {
    this.finishRun(run, 'failed', 0, null, error);
    this.afterFailedRun(run, error);
  }

  private finishRun(run: Run, status: Run['status'], costUsd: number, sessionId: string | null, error: string | null): void {
    const u = runsRepo.update(this.d.db, run.id, { status, costUsd, sessionId, error, endedAt: this.d.now().toISOString() });
    this.d.bus.emit({ type: 'run.updated', run: u });
  }

  private failTask(t: Task, reason: string): void {
    this.d.company.hqSetTaskStatus(t.id, 'failed', { failureReason: reason });
    if (getAgent(t.assigneeId).role !== 'specialist') this.block(t.projectId, `${getAgent(t.assigneeId).title}: ${reason}`);
  }

  private block(projectId: string, reason: string): void {
    const p = projectsRepo.get(this.d.db, projectId);
    if (p && !p.blocked) this.d.company.hqBlockProject(projectId, reason);
  }

  private topLevelDeliveryCount(projectId: string | null): number {
    if (!projectId) return 0;
    return tasksRepo.listByProject(this.d.db, projectId).filter(t => t.parentId === null && t.phase === 'delivery').length;
  }

  private boardSummary(): string {
    const ps: Project[] = projectsRepo.list(this.d.db).filter(p => p.status !== 'done' && p.status !== 'rejected');
    if (!ps.length) return '(no open projects)';
    const label = (s: string) => BOARD_COLUMNS.find(c => c.id === s)?.label ?? s;
    const pending = approvalsRepo.listPending(this.d.db).length;
    return [
      ...ps.map(p => `- ${p.id} "${p.title}": ${label(p.status)}${p.blocked ? ` (BLOCKED: ${p.blockedReason})` : ''}`),
      `Items waiting for the founder's approval: ${pending}`,
    ].join('\n');
  }
}
