// The company's rulebook. Every action an agent, the founder, or HQ itself can take
// goes through here: checked against the hierarchy, recorded in the audit log, announced on the bus.
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/db.ts';
import * as projects from '../db/repos/projects.ts';
import * as tasks from '../db/repos/tasks.ts';
import * as approvals from '../db/repos/approvals.ts';
import * as budgets from '../db/repos/budgets.ts';
import * as crossTeam from '../db/repos/crossTeam.ts';
import * as auditRepo from '../db/repos/audit.ts';
import type { EventBus } from '../events/bus.ts';
import type { Workspaces } from '../workspace/workspaces.ts';
import { findAgent, getAgent } from '../org/roster.ts';
import { canAssign } from '../org/hierarchy.ts';
import { PolicyError } from './errors.ts';
import { assertProjectTransition, assertTaskTransition, isTerminal } from './lifecycle.ts';
import type {
  Approval, Budget, CrossTeamRequest, DeptId, OutboundKind, Phase, Project, ProjectStatus, RunPurpose, Task, TaskStatus,
} from '../types.ts';

export interface CallerCtx {
  agentId: string;
  runId: string;
  taskId: string | null;
  projectId: string | null;
  purpose: RunPurpose;
  crossTeamRequestId: string | null;
}

export type BudgetInput = Omit<Budget, 'projectId' | 'setBy' | 'updatedAt'>;

export const REWORK_CAP = 2;
const ESCALATED = 'escalated: rework cap reached';

export class Company {
  private readonly db: Db;
  private readonly bus: EventBus;
  private readonly ws: Workspaces;

  constructor(db: Db, bus: EventBus, ws: Workspaces) {
    this.db = db;
    this.bus = bus;
    this.ws = ws;
  }

  // ---------- agent actions ----------

  getTaskContext(c: CallerCtx): { task: Task; project: Project; inboxFiles: string[] } {
    const task = this.ownTask(c);
    return { task, project: this.project(task.projectId), inboxFiles: listFiles(path.join(this.ws.dirOf(c.agentId), 'inbox'), 'inbox') };
  }

  getBoard(c: CallerCtx): { projects: Project[]; pendingApprovals: number } {
    this.requireRole(c, 'ceo');
    return { projects: projects.list(this.db), pendingApprovals: approvals.listPending(this.db).length };
  }

  createProject(c: CallerCtx, input: { title: string; brief: string }): Project {
    this.requireRole(c, 'ceo');
    const p = projects.create(this.db, { ...input, status: 'sharpening' });
    this.record(c.agentId, 'project.created', 'project', p.id, { title: p.title });
    this.bus.emit({ type: 'project.updated', project: p });
    return p;
  }

  updateBrief(c: CallerCtx, input: { projectId: string; brief: string }): Project {
    this.requireRole(c, 'ceo');
    const p = this.project(input.projectId);
    if (p.status !== 'idea' && p.status !== 'sharpening') throw new PolicyError('wrong_status', 'The brief can only change while the project is an idea or being sharpened.');
    return this.saveProject(c.agentId, 'project.brief_updated', p.id, { brief: input.brief });
  }

  assignToLead(c: CallerCtx, input: { leadId: string; title: string; instructions: string; attachFiles?: string[] }): Task {
    this.requireRole(c, 'ceo');
    if (c.purpose !== 'plan_delivery' && c.purpose !== 'triage') throw new PolicyError('not_allowed', 'You can only assign delivery work while planning delivery or handling a cross-team request.');
    if (findAgent(input.leadId)?.role !== 'lead') throw new PolicyError('not_allowed', `${input.leadId} is not a department lead.`);
    if (!c.projectId) throw new PolicyError('not_found', 'This run has no project.');
    const p = this.project(c.projectId);
    if (p.status !== 'in_progress') throw new PolicyError('wrong_status', 'Delivery work can only be assigned to an approved project.');
    const attachments = (input.attachFiles ?? []).map(f => this.ws.resolveOwnFile(c.agentId, f));
    const t = tasks.create(this.db, {
      projectId: p.id, parentId: null, phase: 'delivery', assigneeId: input.leadId, assignedById: 'ceo',
      title: input.title, instructions: input.instructions, attachments,
      crossTeamRequestId: c.purpose === 'triage' ? c.crossTeamRequestId : null,
    });
    if (c.purpose === 'triage' && c.crossTeamRequestId) {
      crossTeam.update(this.db, c.crossTeamRequestId, { status: 'accepted', resolution: `Assigned task ${t.id} to ${input.leadId}` });
    }
    this.record(c.agentId, 'task.assigned', 'task', t.id, { to: input.leadId, title: t.title });
    this.bus.emit({ type: 'task.created', task: t });
    return t;
  }

  createSubtask(c: CallerCtx, input: { assigneeId: string; title: string; instructions: string; attachFiles?: string[] }): Task {
    this.requireRole(c, 'lead');
    const parent = this.ownTask(c);
    if (parent.status !== 'running') throw new PolicyError('wrong_status', 'You can only split a task you are working on.');
    if (!canAssign(c.agentId, input.assigneeId)) throw new PolicyError('not_your_report', `${input.assigneeId} does not report to you.`);
    const attachments = (input.attachFiles ?? []).map(f => this.ws.resolveOwnFile(c.agentId, f));
    const t = tasks.create(this.db, {
      projectId: parent.projectId, parentId: parent.id, phase: parent.phase, assigneeId: input.assigneeId,
      assignedById: c.agentId, title: input.title, instructions: input.instructions, attachments,
    });
    this.record(c.agentId, 'task.assigned', 'task', t.id, { to: input.assigneeId, parent: parent.id, title: t.title });
    this.bus.emit({ type: 'task.created', task: t });
    return t;
  }

  submitResult(c: CallerCtx, input: { summary: string; files: string[] }): Task {
    const task = this.ownTask(c);
    if (task.status !== 'running') throw new PolicyError('wrong_status', 'This task is not in progress.');
    if (tasks.listChildren(this.db, task.id).some(s => !isTerminal(s.status))) {
      throw new PolicyError('subtasks_open', 'Some of your subtasks are not finished yet.');
    }
    if (c.agentId === 'cfo' && task.phase === 'budgeting' && !budgets.get(this.db, task.projectId)) {
      throw new PolicyError('budget_missing', 'Record the project budget with set_budget before submitting.');
    }
    const stored = this.ws.storeDeliverables(task.projectId, task.id, this.ws.collectOutbox(c.agentId, input.files));
    const isReport = task.phase === 'report' && c.agentId === 'ceo';
    const updated = this.moveTask(c.agentId, 'task.submitted', task, isReport ? 'done' : 'in_review', {
      resultSummary: input.summary, resultFiles: stored,
    });
    if (isReport) this.moveProject(c.agentId, task.projectId, 'awaiting_founder');
    return updated;
  }

  reviewResult(c: CallerCtx, input: { taskId: string; decision: 'accept' | 'rework'; feedback: string }): Task {
    const task = this.task(input.taskId);
    if (task.assignedById !== c.agentId) throw new PolicyError('not_reviewer', 'You can only review work you assigned.');
    if (task.status !== 'in_review') throw new PolicyError('wrong_status', 'This task is not waiting for review.');
    if (input.decision === 'accept') {
      return this.moveTask(c.agentId, 'task.accepted', task, 'done', { feedback: input.feedback || null });
    }
    const reworkCount = task.reworkCount + 1;
    if (reworkCount > REWORK_CAP) {
      const failed = this.moveTask(c.agentId, 'task.escalated', task, 'failed', { reworkCount, feedback: input.feedback, failureReason: ESCALATED });
      if (getAgent(task.assigneeId).role === 'lead') this.hqBlockProject(task.projectId, ESCALATED);
      return failed;
    }
    return this.moveTask(c.agentId, 'task.rework_requested', task, 'rework', { reworkCount, feedback: input.feedback });
  }

  requestCrossTeam(c: CallerCtx, input: { targetDept: DeptId; need: string }): CrossTeamRequest {
    this.requireRole(c, 'lead');
    const task = this.ownTask(c);
    if (getAgent(c.agentId).dept === input.targetDept) throw new PolicyError('not_allowed', 'That is your own department; assign it to your specialists.');
    const r = crossTeam.create(this.db, { projectId: task.projectId, fromAgentId: c.agentId, targetDept: input.targetDept, need: input.need });
    this.record(c.agentId, 'crossteam.requested', 'crossteam', r.id, { targetDept: input.targetDept });
    this.bus.emit({ type: 'crossteam.created', request: r });
    return r;
  }

  declineCrossTeam(c: CallerCtx, input: { requestId: string; reason: string }): CrossTeamRequest {
    this.requireRole(c, 'ceo');
    if (c.purpose !== 'triage') throw new PolicyError('not_allowed', 'Cross-team requests are handled in triage.');
    const r = crossTeam.get(this.db, input.requestId);
    if (!r) throw new PolicyError('not_found', 'No such request.');
    if (r.status !== 'open') throw new PolicyError('already_decided', 'This request was already handled.');
    const u = crossTeam.update(this.db, r.id, { status: 'declined', resolution: input.reason });
    this.record(c.agentId, 'crossteam.declined', 'crossteam', r.id, { reason: input.reason });
    return u;
  }

  requestOutbound(c: CallerCtx, input: { kind: OutboundKind; destination: string; subject?: string; content: string; files?: string[] }): Approval {
    const task = this.ownTask(c);
    const files = this.ws.storeDeliverables(task.projectId, `outbound-${task.id}`, this.ws.collectOutbox(c.agentId, input.files ?? []));
    const a = approvals.create(this.db, {
      projectId: task.projectId, taskId: task.id, agentId: c.agentId, kind: input.kind, destination: input.destination,
      subject: input.subject ?? null, content: input.content, files,
    });
    this.record(c.agentId, 'outbound.requested', 'approval', a.id, { kind: a.kind, destination: a.destination });
    this.bus.emit({ type: 'approval.created', approval: a });
    return a;
  }

  recommendOutbound(c: CallerCtx, input: { approvalId: string; recommendation: 'approve' | 'edit' | 'reject'; note: string }): Approval {
    this.requireRole(c, 'ceo');
    const a = this.pendingApproval(input.approvalId);
    const u = approvals.update(this.db, a.id, { ceoRecommendation: input.recommendation, ceoNote: input.note });
    this.record(c.agentId, 'outbound.recommended', 'approval', a.id, { recommendation: input.recommendation });
    this.bus.emit({ type: 'approval.updated', approval: u });
    return u;
  }

  setBudget(c: CallerCtx, input: BudgetInput): Budget {
    if (c.agentId !== 'cfo') throw new PolicyError('not_allowed', 'Only the CFO records project budgets.');
    if (!c.projectId) throw new PolicyError('not_found', 'This run has no project.');
    const p = this.project(c.projectId);
    if (p.status !== 'budgeting') throw new PolicyError('wrong_status', 'Budgets are set during the Budgeting step.');
    const b = budgets.upsert(this.db, { ...input, projectId: p.id, setBy: c.agentId });
    this.record(c.agentId, 'budget.set', 'project', p.id, { estimatedAiUsd: b.estimatedAiUsd, estimatedRuns: b.estimatedRuns });
    this.bus.emit({ type: 'budget.updated', budget: b });
    return b;
  }

  // ---------- founder actions ----------

  founderAddProject(input: { title: string; brief: string; status: 'idea' | 'sharpening' }): Project {
    const p = projects.create(this.db, input);
    this.record('founder', 'project.created', 'project', p.id, { title: p.title });
    this.bus.emit({ type: 'project.updated', project: p });
    return p;
  }

  startDiscussion(projectId: string): Project {
    return this.moveProject('founder', projectId, 'sharpening');
  }

  acceptBrief(projectId: string): Project {
    return this.moveProject('founder', projectId, 'conception');
  }

  decidePlan(projectId: string, decision: 'approve' | 'reject' | 'revise', feedback?: string): Project {
    const p = this.project(projectId);
    if (p.status !== 'awaiting_approval') throw new PolicyError('bad_transition', 'This project is not waiting for plan approval.');
    if (decision === 'approve') return this.moveProject('founder', projectId, 'in_progress');
    if (decision === 'reject') return this.moveProject('founder', projectId, 'rejected');
    const brief = feedback ? `${p.brief}\n\nFounder feedback on the plan: ${feedback}` : p.brief;
    return this.moveProject('founder', projectId, 'sharpening', { brief });
  }

  decideApproval(approvalId: string, decision: 'approve' | 'reject', editedContent?: string): Approval {
    const a = approvals.get(this.db, approvalId);
    if (!a) throw new PolicyError('not_found', 'No such approval.');
    if (a.status !== 'pending') throw new PolicyError('already_decided', 'This item was already decided.');
    const u = approvals.update(this.db, a.id, {
      status: decision === 'approve' ? 'approved' : 'rejected',
      founderEdit: decision === 'approve' && editedContent !== undefined && editedContent !== a.content ? editedContent : null,
      decidedAt: new Date().toISOString(),
    });
    this.record('founder', `outbound.${u.status}`, 'approval', a.id, {});
    this.bus.emit({ type: 'approval.updated', approval: u });
    return u;
  }

  decideReport(projectId: string, decision: 'accept' | 'send_back', feedback?: string): Project {
    const p = this.project(projectId);
    if (decision === 'accept') return this.moveProject('founder', projectId, 'done');
    const brief = feedback ? `${p.brief}\n\nFounder feedback on the delivery: ${feedback}` : p.brief;
    return this.moveProject('founder', projectId, 'in_progress', { brief });
  }

  unblock(projectId: string): Project {
    return this.saveProject('founder', 'project.unblocked', projectId, { blocked: false, blockedReason: null });
  }

  // ---------- HQ (orchestrator) actions ----------

  hqCreatePhaseTask(input: { projectId: string; phase: Phase; assigneeId: string; title: string; instructions: string; attachAbs: string[]; assignedById: 'ceo' }): Task {
    const t = tasks.create(this.db, {
      projectId: input.projectId, parentId: null, phase: input.phase, assigneeId: input.assigneeId,
      assignedById: input.assignedById, title: input.title, instructions: input.instructions, attachments: input.attachAbs,
    });
    this.record('hq', 'task.assigned', 'task', t.id, { to: t.assigneeId, phase: t.phase, title: t.title });
    this.bus.emit({ type: 'task.created', task: t });
    return t;
  }

  hqSetTaskStatus(taskId: string, to: TaskStatus, patch: Partial<Task> = {}): Task {
    return this.moveTask('hq', `task.${to}`, this.task(taskId), to, patch);
  }

  hqSetProjectStatus(projectId: string, to: ProjectStatus): Project {
    return this.moveProject('hq', projectId, to);
  }

  hqBlockProject(projectId: string, reason: string): Project {
    return this.saveProject('hq', 'project.blocked', projectId, { blocked: true, blockedReason: reason });
  }

  // ---------- helpers ----------

  private requireRole(c: CallerCtx, role: 'ceo' | 'lead') {
    if (findAgent(c.agentId)?.role !== role) {
      throw new PolicyError('not_allowed', role === 'ceo' ? 'Only the CEO can do this.' : 'Only department leads can do this.');
    }
  }

  private ownTask(c: CallerCtx): Task {
    if (!c.taskId) throw new PolicyError('not_allowed', 'This run has no task.');
    const t = this.task(c.taskId);
    if (t.assigneeId !== c.agentId) throw new PolicyError('not_assignee', 'This task is not assigned to you.');
    return t;
  }

  private task(id: string): Task {
    const t = tasks.get(this.db, id);
    if (!t) throw new PolicyError('not_found', `No task ${id}.`);
    return t;
  }

  private project(id: string): Project {
    const p = projects.get(this.db, id);
    if (!p) throw new PolicyError('not_found', `No project ${id}.`);
    return p;
  }

  private pendingApproval(id: string): Approval {
    const a = approvals.get(this.db, id);
    if (!a) throw new PolicyError('not_found', 'No such approval.');
    if (a.status !== 'pending') throw new PolicyError('already_decided', 'This item was already decided.');
    return a;
  }

  private moveTask(actor: string, action: string, task: Task, to: TaskStatus, patch: Partial<Task>): Task {
    assertTaskTransition(task.status, to);
    const u = tasks.update(this.db, task.id, { ...patch, status: to });
    this.record(actor, action, 'task', task.id, { from: task.status, to });
    this.bus.emit({ type: 'task.updated', task: u, prev: task.status });
    return u;
  }

  private moveProject(actor: string, projectId: string, to: ProjectStatus, patch: Partial<Project> = {}): Project {
    const p = this.project(projectId);
    assertProjectTransition(p.status, to);
    const u = projects.update(this.db, p.id, { ...patch, status: to });
    this.record(actor, 'project.moved', 'project', p.id, { from: p.status, to });
    this.bus.emit({ type: 'project.updated', project: u, prev: p.status });
    return u;
  }

  private saveProject(actor: string, action: string, projectId: string, patch: Partial<Project>): Project {
    this.project(projectId);
    const u = projects.update(this.db, projectId, patch);
    this.record(actor, action, 'project', projectId, {});
    this.bus.emit({ type: 'project.updated', project: u });
    return u;
  }

  private record(actorId: string, action: string, entity: string, entityId: string, detail: Record<string, unknown>) {
    auditRepo.append(this.db, { actorId, action, entity, entityId, detail });
  }
}

function listFiles(dir: string, prefix: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? listFiles(path.join(dir, e.name), `${prefix}/${e.name}`) : [`${prefix}/${e.name}`]);
}
