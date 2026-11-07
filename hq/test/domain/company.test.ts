import { beforeEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, type Db } from '../../src/db/db.ts';
import * as tasks from '../../src/db/repos/tasks.ts';
import * as projects from '../../src/db/repos/projects.ts';
import * as audit from '../../src/db/repos/audit.ts';
import { EventBus, type CompanyEvent } from '../../src/events/bus.ts';
import { Company, type CallerCtx } from '../../src/domain/company.ts';
import { Workspaces } from '../../src/workspace/workspaces.ts';
import { PolicyError, type PolicyCode } from '../../src/domain/errors.ts';
import type { Phase, ProjectStatus, Task, TaskStatus } from '../../src/types.ts';

let db: Db;
let ws: Workspaces;
let bus: EventBus;
let company: Company;
let events: CompanyEvent[];

beforeEach(() => {
  db = openDb(':memory:');
  ws = new Workspaces(fs.mkdtempSync(path.join(os.tmpdir(), 'hq-co-')));
  ws.ensureAll();
  bus = new EventBus();
  events = [];
  bus.on(e => events.push(e));
  company = new Company(db, bus, ws);
});

function project(status: ProjectStatus = 'in_progress') {
  return projects.create(db, { title: 'P', brief: 'brief', status });
}

function task(projectId: string, assigneeId: string, assignedById: string, status: TaskStatus, opts: { phase?: Phase; parentId?: string } = {}): Task {
  const t = tasks.create(db, { projectId, parentId: opts.parentId ?? null, phase: opts.phase ?? 'delivery', assigneeId, assignedById, title: 'T', instructions: 'I' });
  return tasks.update(db, t.id, { status });
}

const ctx = (agentId: string, t: Task | null, purpose: CallerCtx['purpose'] = 'work'): CallerCtx =>
  ({ agentId, runId: 'run_x', taskId: t?.id ?? null, projectId: t?.projectId ?? null, purpose, crossTeamRequestId: null });

function expectCode(code: PolicyCode, fn: () => unknown) {
  try { fn(); expect.unreachable('expected a PolicyError'); }
  catch (e) { expect(e).toBeInstanceOf(PolicyError); expect((e as PolicyError).code).toBe(code); }
}

function outboxFile(agentId: string, taskId: string, name: string) {
  const rel = `outbox/${taskId}/${name}`;
  const abs = path.join(ws.dirOf(agentId), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'content');
  return rel;
}

test('specialist cannot create subtasks', () => {
  const p = project();
  const t = task(p.id, 'pentester', 'ciso', 'running');
  expectCode('not_allowed', () => company.createSubtask(ctx('pentester', t), { assigneeId: 'qa-engineer', title: 'x', instructions: 'y' }));
});

test('cto cannot assign pentester', () => {
  const p = project();
  const t = task(p.id, 'cto', 'ceo', 'running');
  expectCode('not_your_report', () => company.createSubtask(ctx('cto', t), { assigneeId: 'pentester', title: 'x', instructions: 'y' }));
});

test('ciso creates subtask for pentester and it is announced', () => {
  const p = project();
  const t = task(p.id, 'ciso', 'ceo', 'running');
  const sub = company.createSubtask(ctx('ciso', t), { assigneeId: 'pentester', title: 'Plan', instructions: 'Write a plan' });
  expect(sub).toMatchObject({ parentId: t.id, assigneeId: 'pentester', assignedById: 'ciso', status: 'queued', phase: 'delivery' });
  expect(events.some(e => e.type === 'task.created' && e.task.id === sub.id)).toBe(true);
});

test('submitResult by non-assignee', () => {
  const p = project();
  const t = task(p.id, 'qa-engineer', 'cto', 'running');
  expectCode('not_assignee', () => company.submitResult(ctx('software-engineer', t), { summary: 's', files: [] }));
});

test('submitResult with open subtasks', () => {
  const p = project();
  const t = task(p.id, 'cto', 'ceo', 'running');
  task(p.id, 'qa-engineer', 'cto', 'queued', { parentId: t.id });
  expectCode('subtasks_open', () => company.submitResult(ctx('cto', t), { summary: 's', files: [] }));
});

test('submitResult stores deliverables and moves to in_review', () => {
  const p = project();
  const t = task(p.id, 'qa-engineer', 'cto', 'running');
  const rel = outboxFile('qa-engineer', t.id, 'report.md');
  company.submitResult(ctx('qa-engineer', t), { summary: 'done', files: [rel] });
  const after = tasks.get(db, t.id)!;
  expect(after.status).toBe('in_review');
  expect(after.resultSummary).toBe('done');
  expect(after.resultFiles).toHaveLength(1);
  expect(ws.isInsideProjects(after.resultFiles[0])).toBe(true);
});

test('cfo budgeting submit without budget', () => {
  const p = project('budgeting');
  const t = task(p.id, 'cfo', 'ceo', 'running', { phase: 'budgeting' });
  expectCode('budget_missing', () => company.submitResult(ctx('cfo', t), { summary: 's', files: [] }));
  company.setBudget(ctx('cfo', t), { estimatedRuns: 5, estimatedAiUsd: 1, externalCosts: [], clientPrice: null, notes: 'n' });
  company.submitResult(ctx('cfo', t), { summary: 's', files: [] });
  expect(tasks.get(db, t.id)!.status).toBe('in_review');
});

test('review by wrong agent', () => {
  const p = project();
  const t = task(p.id, 'qa-engineer', 'cto', 'in_review');
  expectCode('not_reviewer', () => company.reviewResult(ctx('ciso', null, 'review'), { taskId: t.id, decision: 'accept', feedback: '' }));
});

test('third rework escalates and blocks project for lead task', () => {
  const p = project();
  const t = task(p.id, 'cto', 'ceo', 'in_review');
  for (let i = 1; i <= 2; i++) {
    company.reviewResult(ctx('ceo', null, 'review'), { taskId: t.id, decision: 'rework', feedback: `fix ${i}` });
    const r = tasks.get(db, t.id)!;
    expect(r).toMatchObject({ status: 'rework', reworkCount: i, feedback: `fix ${i}` });
    tasks.update(db, t.id, { status: 'in_review' });
  }
  company.reviewResult(ctx('ceo', null, 'review'), { taskId: t.id, decision: 'rework', feedback: 'again' });
  expect(tasks.get(db, t.id)).toMatchObject({ status: 'failed', failureReason: 'escalated: rework cap reached' });
  expect(projects.get(db, p.id)).toMatchObject({ blocked: true, blockedReason: 'escalated: rework cap reached' });
});

test('accept marks task done', () => {
  const p = project();
  const t = task(p.id, 'qa-engineer', 'cto', 'in_review');
  company.reviewResult(ctx('cto', null, 'review'), { taskId: t.id, decision: 'accept', feedback: 'good' });
  expect(tasks.get(db, t.id)!.status).toBe('done');
});

test('setBudget by cto refused', () => {
  const p = project('budgeting');
  const t = task(p.id, 'cto', 'ceo', 'running', { phase: 'budgeting' });
  expectCode('not_allowed', () => company.setBudget(ctx('cto', t), { estimatedRuns: 1, estimatedAiUsd: 1, externalCosts: [], clientPrice: null, notes: '' }));
});

test('createProject by cro refused', () => {
  expectCode('not_allowed', () => company.createProject(ctx('cro', null, 'chat'), { title: 'x', brief: 'y' }));
  const p = company.createProject(ctx('ceo', null, 'chat'), { title: 'x', brief: 'y' });
  expect(p.status).toBe('sharpening');
});

test('requestOutbound creates pending approval and emits approval.created', () => {
  const p = project();
  const t = task(p.id, 'outreach-writer', 'cro', 'running');
  const a = company.requestOutbound(ctx('outreach-writer', t), { kind: 'email', destination: 'cto@bank.tn', subject: 'Hello', content: 'Dear...' });
  expect(a).toMatchObject({ status: 'pending', kind: 'email', projectId: p.id, taskId: t.id });
  expect(events.some(e => e.type === 'approval.created' && e.approval.id === a.id)).toBe(true);
});

test('decideApproval twice', () => {
  const p = project();
  const t = task(p.id, 'outreach-writer', 'cro', 'running');
  const a = company.requestOutbound(ctx('outreach-writer', t), { kind: 'email', destination: 'x', content: 'c' });
  company.decideApproval(a.id, 'approve', 'edited');
  expectCode('already_decided', () => company.decideApproval(a.id, 'reject'));
});

test('ceo report submit moves project to awaiting_founder', () => {
  const p = project('in_progress');
  const t = task(p.id, 'ceo', 'ceo', 'running', { phase: 'report' });
  company.submitResult(ctx('ceo', t), { summary: 'Final report', files: [] });
  expect(tasks.get(db, t.id)!.status).toBe('done');
  expect(projects.get(db, p.id)!.status).toBe('awaiting_founder');
});

test('assignToLead requires ceo, plan_delivery and a lead', () => {
  const p = project('in_progress');
  const c: CallerCtx = { agentId: 'ceo', runId: 'r', taskId: null, projectId: p.id, purpose: 'plan_delivery', crossTeamRequestId: null };
  expectCode('not_allowed', () => company.assignToLead({ ...c, purpose: 'chat' }, { leadId: 'cfo', title: 't', instructions: 'i' }));
  expectCode('not_allowed', () => company.assignToLead(c, { leadId: 'pentester', title: 't', instructions: 'i' }));
  const t = company.assignToLead(c, { leadId: 'cfo', title: 'Costs', instructions: 'Do costs' });
  expect(t).toMatchObject({ assigneeId: 'cfo', assignedById: 'ceo', phase: 'delivery', status: 'queued' });
});

test('founder flow: accept brief then plan decision', () => {
  const p = company.founderAddProject({ title: 'BM', brief: 'b', status: 'sharpening' });
  company.acceptBrief(p.id);
  expect(projects.get(db, p.id)!.status).toBe('conception');
  expectCode('bad_transition', () => company.acceptBrief(p.id));
});

test('every successful mutation appends one audit row', () => {
  const p = project();
  const t = task(p.id, 'ciso', 'ceo', 'running');
  const before = audit.count(db);
  company.createSubtask(ctx('ciso', t), { assigneeId: 'pentester', title: 'Plan', instructions: 'x' });
  expect(audit.count(db)).toBe(before + 1);
});
