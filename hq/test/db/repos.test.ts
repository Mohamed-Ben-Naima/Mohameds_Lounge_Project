import { beforeEach, expect, test } from 'vitest';
import { openDb, type Db } from '../../src/db/db.ts';
import * as projects from '../../src/db/repos/projects.ts';
import * as tasks from '../../src/db/repos/tasks.ts';
import * as runs from '../../src/db/repos/runs.ts';
import * as approvals from '../../src/db/repos/approvals.ts';
import * as budgets from '../../src/db/repos/budgets.ts';
import * as crossTeam from '../../src/db/repos/crossTeam.ts';
import * as audit from '../../src/db/repos/audit.ts';
import * as chat from '../../src/db/repos/chat.ts';
import * as kv from '../../src/db/repos/kv.ts';

let db: Db;
beforeEach(() => { db = openDb(':memory:'); });

function aTask(projectId: string) {
  return tasks.create(db, {
    projectId, parentId: null, phase: 'conception', assigneeId: 'chief-architect', assignedById: 'ceo',
    title: 'Design', instructions: 'Do it', attachments: ['C:/x/brief.md'],
  });
}

test('project roundtrip and update', () => {
  const p = projects.create(db, { title: 'BM', brief: 'b', status: 'sharpening' });
  expect(projects.get(db, p.id)).toMatchObject({ title: 'BM', status: 'sharpening', blocked: false, blockedReason: null });
  const u = projects.update(db, p.id, { status: 'conception', blocked: true, blockedReason: 'x' });
  expect(u).toMatchObject({ status: 'conception', blocked: true, blockedReason: 'x' });
  expect(projects.list(db)).toHaveLength(1);
});

test('task resultFiles JSON roundtrip', () => {
  const p = projects.create(db, { title: 'BM', brief: 'b', status: 'conception' });
  const t = aTask(p.id);
  expect(t).toMatchObject({ status: 'queued', reworkCount: 0, resultFiles: [], attachments: ['C:/x/brief.md'] });
  tasks.update(db, t.id, { resultFiles: ['a.md', 'b.csv'], status: 'running' });
  expect(tasks.get(db, t.id)!.resultFiles).toEqual(['a.md', 'b.csv']);
  expect(tasks.listByProject(db, p.id)).toHaveLength(1);
  const child = tasks.create(db, { projectId: p.id, parentId: t.id, phase: 'conception', assigneeId: 'spec-writer', assignedById: 'chief-architect', title: 'Spec', instructions: 'x' });
  expect(tasks.listChildren(db, t.id).map(c => c.id)).toEqual([child.id]);
});

test('task with unknown project throws', () => {
  expect(() => aTask('prj_nope')).toThrow();
});

test('runs.sumCostByProject sums only that project', () => {
  const p1 = projects.create(db, { title: 'a', brief: '', status: 'conception' });
  const p2 = projects.create(db, { title: 'b', brief: '', status: 'conception' });
  const mk = (projectId: string, cost: number) => {
    const r = runs.create(db, { agentId: 'ceo', purpose: 'work', projectId, taskId: null, payload: {} });
    runs.update(db, r.id, { costUsd: cost });
  };
  mk(p1.id, 0.5); mk(p1.id, 0.25); mk(p2.id, 1.0);
  expect(runs.sumCostByProject(db, p1.id)).toBeCloseTo(0.75);
  expect(runs.listByStatus(db, 'queued')).toHaveLength(3);
});

test('approvals.listPending excludes decided', () => {
  const p = projects.create(db, { title: 'a', brief: '', status: 'in_progress' });
  const t = aTask(p.id);
  const a1 = approvals.create(db, { projectId: p.id, taskId: t.id, agentId: 'outreach-writer', kind: 'email', destination: 'x@y', subject: null, content: 'hi', files: [] });
  approvals.create(db, { projectId: p.id, taskId: t.id, agentId: 'outreach-writer', kind: 'post', destination: 'linkedin', subject: null, content: 'yo', files: ['f'] });
  approvals.update(db, a1.id, { status: 'approved', decidedAt: 'now' });
  const pending = approvals.listPending(db);
  expect(pending).toHaveLength(1);
  expect(pending[0].files).toEqual(['f']);
});

test('budgets upsert and get', () => {
  const p = projects.create(db, { title: 'a', brief: '', status: 'budgeting' });
  budgets.upsert(db, { projectId: p.id, estimatedRuns: 10, estimatedAiUsd: 2, externalCosts: [{ item: 'domain', amount: 40, currency: 'TND', recurring: 'yearly' }], clientPrice: null, notes: 'n', setBy: 'cfo' });
  budgets.upsert(db, { projectId: p.id, estimatedRuns: 12, estimatedAiUsd: 3, externalCosts: [], clientPrice: { amount: 100, currency: 'EUR' }, notes: 'n2', setBy: 'cfo' });
  expect(budgets.get(db, p.id)).toMatchObject({ estimatedRuns: 12, clientPrice: { amount: 100, currency: 'EUR' }, externalCosts: [] });
});

test('cross team request roundtrip', () => {
  const p = projects.create(db, { title: 'a', brief: '', status: 'in_progress' });
  const r = crossTeam.create(db, { projectId: p.id, fromAgentId: 'cto', targetDept: 'cybersecurity', need: 'review' });
  expect(crossTeam.update(db, r.id, { status: 'declined', resolution: 'no' })).toMatchObject({ status: 'declined' });
});

test('kv set/get/clear', () => {
  expect(kv.get(db, 'k')).toBeNull();
  kv.set(db, 'k', 'v');
  expect(kv.get(db, 'k')).toBe('v');
  kv.set(db, 'k', null);
  expect(kv.get(db, 'k')).toBeNull();
});

test('audit.list returns newest first', () => {
  audit.append(db, { actorId: 'ceo', action: 'first', entity: 'project', entityId: 'p', detail: {} });
  audit.append(db, { actorId: 'ceo', action: 'second', entity: 'project', entityId: 'p', detail: { a: 1 } });
  const list = audit.list(db, 10);
  expect(list.map(e => e.action)).toEqual(['second', 'first']);
  expect(list[0].detail).toEqual({ a: 1 });
});

test('chat append and list oldest first', () => {
  chat.append(db, 'founder', 'hello');
  chat.append(db, 'ceo', 'hi');
  expect(chat.list(db, 50).map(m => m.role)).toEqual(['founder', 'ceo']);
});
