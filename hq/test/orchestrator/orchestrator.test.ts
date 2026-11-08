import { expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../src/db/db.ts';
import * as tasks from '../../src/db/repos/tasks.ts';
import * as projects from '../../src/db/repos/projects.ts';
import * as runs from '../../src/db/repos/runs.ts';
import * as budgets from '../../src/db/repos/budgets.ts';
import * as kv from '../../src/db/repos/kv.ts';
import { EventBus } from '../../src/events/bus.ts';
import { Company } from '../../src/domain/company.ts';
import { Workspaces } from '../../src/workspace/workspaces.ts';
import { TokenRegistry } from '../../src/orchestrator/tokens.ts';
import { RunQueue } from '../../src/orchestrator/queue.ts';
import { Orchestrator } from '../../src/orchestrator/orchestrator.ts';
import { loadConfig } from '../../src/config.ts';
import type { AgentRunner, RunOutcome } from '../../src/runner/types.ts';
import { ScriptedRunner, reviewedId, type Script } from '../support/scriptedRunner.ts';

function setup(scripts: Record<string, Script> = {}, opts: { maxWork?: number; realClock?: boolean; pausedForMs?: number; runner?: (h: { company: Company; tokens: TokenRegistry }) => AgentRunner } = {}) {
  const clock = { now: new Date('2026-11-07T10:00:00Z') };
  const now = () => (opts.realClock ? new Date() : clock.now);
  const db = openDb(':memory:');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-orch-'));
  const ws = new Workspaces(root);
  ws.ensureAll();
  const bus = new EventBus();
  const company = new Company(db, bus, ws);
  const tokens = new TokenRegistry();
  const queue = new RunQueue(db, bus, { maxWork: opts.maxWork ?? 1, now });
  const runner = opts.runner ? opts.runner({ company, tokens }) : new ScriptedRunner(company, tokens, scripts);
  const config = { ...loadConfig({}), dataDir: root };
  const orch = new Orchestrator({ db, bus, company, queue, ws, tokens, runner, config, now });
  if (opts.pausedForMs) kv.set(db, 'paused_until', new Date(now().getTime() + opts.pausedForMs).toISOString());
  orch.start();
  const outbox = (agentId: string, taskId: string, name: string) => {
    const rel = `outbox/${taskId}/${name}`;
    const abs = path.join(ws.dirOf(agentId), rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${name} by ${agentId}`);
    return rel;
  };
  return { db, ws, bus, company, tokens, queue, orch, runner, clock, outbox };
}

const accept: Script = (c, co, spec) => { co.reviewResult(c, { taskId: reviewedId(spec), decision: 'accept', feedback: 'good' }); };

function chainScripts(h: () => ReturnType<typeof setup>): Record<string, Script> {
  return {
    'chief-architect:work': (c, co) => { co.createSubtask(c, { assigneeId: 'solution-architect', title: 'Architecture', instructions: 'Design it' }); },
    'solution-architect:work': (c, co) => { co.submitResult(c, { summary: 'Architecture ready', files: [h().outbox('solution-architect', c.taskId!, 'arch.md')] }); },
    'chief-architect:review': accept,
    'chief-architect:compile': (c, co) => { co.submitResult(c, { summary: 'Design compiled', files: [h().outbox('chief-architect', c.taskId!, 'design.md')] }); },
    'ceo:review': accept,
    'cfo:work': (c, co) => {
      const { task } = co.getTaskContext(c);
      if (task.phase === 'budgeting') co.setBudget(c, { estimatedRuns: 20, estimatedAiUsd: 3, externalCosts: [{ item: 'Domain', amount: 45, currency: 'TND', recurring: 'yearly' }], clientPrice: null, notes: 'n' });
      co.submitResult(c, { summary: `cfo ${task.phase}`, files: [h().outbox('cfo', c.taskId!, 'budget.csv')] });
    },
    'ceo:plan_delivery': (c, co) => {
      co.assignToLead(c, { leadId: 'cfo', title: 'Cost model', instructions: 'Build the cost model' });
      co.assignToLead(c, { leadId: 'cmo', title: 'Market scan', instructions: 'Scan the market' });
    },
    'cmo:work': (c, co) => { co.submitResult(c, { summary: 'scan', files: [h().outbox('cmo', c.taskId!, 'scan.md')] }); },
    'ceo:work': (c, co) => { co.submitResult(c, { summary: 'Final report', files: [h().outbox('ceo', c.taskId!, 'report.md')] }); },
  };
}

test('full chain to awaiting_approval', async () => {
  let h!: ReturnType<typeof setup>;
  h = setup(chainScripts(() => h));
  const p = h.company.founderAddProject({ title: 'Business Model Sprint', brief: 'What does it cost?', status: 'sharpening' });
  h.company.acceptBrief(p.id);
  await h.orch.idle();
  expect(projects.get(h.db, p.id)!.status).toBe('awaiting_approval');
  expect(budgets.get(h.db, p.id)).not.toBeNull();
  const all = tasks.listByProject(h.db, p.id);
  expect(all.every(t => t.status === 'done')).toBe(true);
  expect(all.flatMap(t => t.resultFiles).length).toBeGreaterThanOrEqual(3);
  const cfoTask = all.find(t => t.assigneeId === 'cfo')!;
  expect(cfoTask.attachments.length).toBeGreaterThanOrEqual(1);
});

test('approval to done', async () => {
  let h!: ReturnType<typeof setup>;
  h = setup(chainScripts(() => h));
  const p = h.company.founderAddProject({ title: 'BM', brief: 'b', status: 'sharpening' });
  h.company.acceptBrief(p.id);
  await h.orch.idle();
  h.company.decidePlan(p.id, 'approve');
  await h.orch.idle();
  expect(projects.get(h.db, p.id)!.status).toBe('awaiting_founder');
  const report = tasks.listByProject(h.db, p.id).find(t => t.phase === 'report')!;
  expect(report).toMatchObject({ assigneeId: 'ceo', status: 'done' });
  expect(report.attachments.length).toBeGreaterThanOrEqual(3);
  h.company.decideReport(p.id, 'accept');
  expect(projects.get(h.db, p.id)!.status).toBe('done');
  const projectRuns = runs.listByProject(h.db, p.id);
  expect(runs.sumCostByProject(h.db, p.id)).toBeCloseTo(0.01 * projectRuns.length);
});

test('run ending without submit marks task failed', async () => {
  const h = setup({});
  const p = h.company.founderAddProject({ title: 'P', brief: 'b', status: 'sharpening' });
  h.company.acceptBrief(p.id);
  await h.orch.idle();
  const t = tasks.listByProject(h.db, p.id)[0];
  expect(t).toMatchObject({ status: 'failed', failureReason: 'ended without submit_result' });
  expect(projects.get(h.db, p.id)!.blocked).toBe(true);
});

test('failed lead task blocks project', async () => {
  const h = setup({ 'chief-architect:work': () => ({ ok: false, error: 'boom' }) });
  const p = h.company.founderAddProject({ title: 'P', brief: 'b', status: 'sharpening' });
  h.company.acceptBrief(p.id);
  await h.orch.idle();
  expect(tasks.listByProject(h.db, p.id)[0]).toMatchObject({ status: 'failed', failureReason: 'boom' });
  expect(projects.get(h.db, p.id)).toMatchObject({ blocked: true });
});

test('usage limit pauses queue and requeues task', async () => {
  let h!: ReturnType<typeof setup>;
  h = setup({
    'chief-architect:work': (c, co, _spec, call) => {
      if (call === 1) return { ok: false, usageLimit: { resetAt: new Date(h.clock.now.getTime() + 3600_000) }, error: 'usage limit' };
      co.submitResult(c, { summary: 'tiny design', files: [] });
    },
  });
  const p = h.company.founderAddProject({ title: 'P', brief: 'b', status: 'sharpening' });
  h.company.acceptBrief(p.id);
  await h.orch.idle();
  const t = tasks.listByProject(h.db, p.id)[0];
  expect(t.status).toBe('queued');
  expect(h.queue.isPaused()).toBe(true);
  expect(runs.listByStatus(h.db, 'paused')).toHaveLength(1);
  expect(runs.listByStatus(h.db, 'running')).toHaveLength(0);
  h.clock.now = new Date(h.clock.now.getTime() + 2 * 3600_000);
  h.orch.pump();
  await h.orch.idle();
  expect(h.queue.isPaused()).toBe(false);
  expect(tasks.get(h.db, t.id)!.status).toBe('in_review');
});

test('recovers orphaned runs on startup', () => {
  const h = setup({});
  const p = projects.create(h.db, { title: 'P', brief: '', status: 'conception' });
  const t = tasks.create(h.db, { projectId: p.id, parentId: null, phase: 'conception', assigneeId: 'chief-architect', assignedById: 'ceo', title: 't', instructions: 'i' });
  tasks.update(h.db, t.id, { status: 'running' });
  const r = runs.create(h.db, { agentId: 'chief-architect', purpose: 'work', taskId: t.id, projectId: p.id, payload: {} });
  runs.update(h.db, r.id, { status: 'running' });
  h.queue.recoverOrphans();
  expect(tasks.get(h.db, t.id)!.status).toBe('queued');
  expect(runs.get(h.db, r.id)!.status).toBe('queued');
});

function heldRunner() {
  const pending: ((o: RunOutcome) => void)[] = [];
  const runner: AgentRunner = { run: () => new Promise<RunOutcome>(res => pending.push(res)) };
  const releaseAll = () => { while (pending.length) pending.shift()!({ ok: false, costUsd: 0, sessionId: null, finalText: '', usageLimit: null, error: 'released' }); };
  return { runner, pending, releaseAll };
}

test('max one work run at a time', async () => {
  const held = heldRunner();
  const h = setup({}, { runner: () => held.runner });
  for (const title of ['A', 'B']) {
    const p = h.company.founderAddProject({ title, brief: 'b', status: 'sharpening' });
    h.company.acceptBrief(p.id);
  }
  await new Promise(r => setTimeout(r, 10));
  expect(runs.listByStatus(h.db, 'running')).toHaveLength(1);
  expect(runs.listByStatus(h.db, 'queued')).toHaveLength(1);
  held.releaseAll();
  await new Promise(r => setTimeout(r, 10));
  held.releaseAll();
  await h.orch.idle();
});

test('chat lane runs alongside a work run', async () => {
  const held = heldRunner();
  const h = setup({}, { runner: () => held.runner });
  const p = h.company.founderAddProject({ title: 'A', brief: 'b', status: 'sharpening' });
  h.company.acceptBrief(p.id);
  h.queue.enqueue({ agentId: 'ceo', purpose: 'chat', payload: { text: 'hello' } });
  h.orch.pump();
  await new Promise(r => setTimeout(r, 10));
  expect(runs.listByStatus(h.db, 'running').map(r => r.purpose).sort()).toEqual(['chat', 'work']);
  held.releaseAll();
  await h.orch.idle();
});

test('cross-team request goes to CEO triage', async () => {
  const h = setup({
    'cto:work': (c, co) => {
      co.requestCrossTeam(c, { targetDept: 'cybersecurity', need: 'Security review of the API' });
      co.submitResult(c, { summary: 'API built, needs security review', files: [] });
    },
  });
  const p = projects.create(h.db, { title: 'P', brief: 'b', status: 'in_progress' });
  h.company.hqCreatePhaseTask({ projectId: p.id, phase: 'delivery', assigneeId: 'cto', title: 'Build API', instructions: 'i', attachAbs: [], assignedById: 'ceo' });
  await h.orch.idle();
  const triage = runs.listByProject(h.db, p.id).find(r => r.purpose === 'triage');
  expect(triage).toBeDefined();
  expect(triage!.agentId).toBe('ceo');
  expect(typeof triage!.payload.crossTeamRequestId).toBe('string');
});

// ---- review fixes ----

test('CEO rework on a lead task with subtasks recompiles it', async () => {
  let h!: ReturnType<typeof setup>;
  const scripts = chainScripts(() => h);
  let ceoReviews = 0;
  scripts['ceo:review'] = (c, co, spec) => {
    ceoReviews++;
    co.reviewResult(c, { taskId: reviewedId(spec), decision: ceoReviews === 1 ? 'rework' : 'accept', feedback: 'Add the 3 scales' });
  };
  h = setup(scripts);
  const p = h.company.founderAddProject({ title: 'P', brief: 'b', status: 'sharpening' });
  h.company.acceptBrief(p.id);
  await h.orch.idle();
  expect(projects.get(h.db, p.id)!.status).toBe('awaiting_approval');
  const runner = h.runner as ScriptedRunner;
  expect(runner.calls.filter(c => c.agentId === 'chief-architect' && c.purpose === 'compile')).toHaveLength(2);
  expect(runner.calls.find(c => c.agentId === 'chief-architect' && c.purpose === 'compile' && c.prompt.includes('Add the 3 scales'))).toBeDefined();
});

test('unblock retries a failed phase task', async () => {
  const h = setup({
    'chief-architect:work': (c, co, _s, call) => { if (call >= 2) co.submitResult(c, { summary: 'design', files: [] }); },
    'ceo:review': accept,
  });
  const p = h.company.founderAddProject({ title: 'P', brief: 'b', status: 'sharpening' });
  h.company.acceptBrief(p.id);
  await h.orch.idle();
  expect(projects.get(h.db, p.id)!.blocked).toBe(true);
  h.company.unblock(p.id);
  h.orch.retry(p.id);
  await h.orch.idle();
  expect(projects.get(h.db, p.id)!.status).toBe('budgeting');
  h.orch.retry(p.id);
  expect(tasks.listByProject(h.db, p.id).filter(t => t.phase === 'conception' && t.parentId === null)).toHaveLength(2);
});

test('report is created when the last delivery task fails', async () => {
  const h = setup({ 'cfo:work': () => ({ ok: false, error: 'timeout' }) });
  const p = projects.create(h.db, { title: 'P', brief: 'b', status: 'in_progress' });
  h.company.hqCreatePhaseTask({ projectId: p.id, phase: 'delivery', assigneeId: 'cfo', title: 'Costs', instructions: 'i', attachAbs: [], assignedById: 'ceo' });
  await h.orch.idle();
  expect(tasks.listByProject(h.db, p.id).some(t => t.phase === 'report')).toBe(true);
});

test('lead can retry a failed subtask during compile', async () => {
  const h = setup({
    'cfo:work': (c, co) => { co.createSubtask(c, { assigneeId: 'cost-controller', title: 'Prices', instructions: 'i' }); },
    'cost-controller:work': (c, co, _s, call) => { if (call >= 2) co.submitResult(c, { summary: 'prices', files: [] }); },
    'cfo:compile': (c, co, _s, call) => {
      if (call === 1) co.createSubtask(c, { assigneeId: 'cost-controller', title: 'Prices again', instructions: 'retry' });
      else co.submitResult(c, { summary: 'compiled', files: [] });
    },
    'cfo:review': accept,
    'ceo:review': accept,
    'ceo:work': (c, co) => { co.submitResult(c, { summary: 'report', files: [] }); },
  });
  const p = projects.create(h.db, { title: 'P', brief: 'b', status: 'in_progress' });
  const t = h.company.hqCreatePhaseTask({ projectId: p.id, phase: 'delivery', assigneeId: 'cfo', title: 'Costs', instructions: 'i', attachAbs: [], assignedById: 'ceo' });
  await h.orch.idle();
  expect(tasks.get(h.db, t.id)!.status).toBe('done');
  expect(projects.get(h.db, p.id)!.blocked).toBe(false);
});

test('a paused company resumes on its own after a restart', async () => {
  const h = setup({ 'chief-architect:work': (c, co) => { co.submitResult(c, { summary: 'd', files: [] }); } }, { realClock: true, pausedForMs: 100 });
  const p = h.company.founderAddProject({ title: 'P', brief: 'b', status: 'sharpening' });
  h.company.acceptBrief(p.id);
  expect(h.queue.isPaused()).toBe(true);
  await new Promise(r => setTimeout(r, 1600));
  await h.orch.idle();
  expect(tasks.listByProject(h.db, p.id)[0].status).toBe('in_review');
});

test('a usage limit with a past reset time still pauses at least a minute', async () => {
  let h!: ReturnType<typeof setup>;
  h = setup({ 'chief-architect:work': () => ({ ok: false, usageLimit: { resetAt: new Date(h.clock.now.getTime() - 3600_000) }, error: 'limit' }) });
  const p = h.company.founderAddProject({ title: 'P', brief: 'b', status: 'sharpening' });
  h.company.acceptBrief(p.id);
  await h.orch.idle();
  expect(h.queue.isPaused()).toBe(true);
  expect(h.queue.pausedUntil()!.getTime()).toBeGreaterThanOrEqual(h.clock.now.getTime() + 60_000);
});

test('one non-chat run per agent at a time', () => {
  const h = setup({}, { maxWork: 3, runner: () => ({ run: () => new Promise(() => {}) }) });
  h.queue.enqueue({ agentId: 'ceo', purpose: 'review' });
  h.queue.enqueue({ agentId: 'ceo', purpose: 'plan_delivery' });
  h.queue.enqueue({ agentId: 'cmo', purpose: 'work' });
  h.queue.enqueue({ agentId: 'ceo', purpose: 'chat' });
  const start = h.queue.nextStartable().map(r => `${r.agentId}:${r.purpose}`).sort();
  expect(start).toEqual(['ceo:chat', 'ceo:review', 'cmo:work']);
});
