import { expect, test } from 'vitest';
import { reduce, groupByColumn, inboxCount, type UiState, type ProjectView } from '../src/store.ts';
import { ROSTER, DEPARTMENTS } from '../../src/org/roster.ts';
import type { Approval, Task } from '../../src/types.ts';

const project = (id: string, status: ProjectView['status'], over: Partial<ProjectView> = {}): ProjectView => ({
  id, title: id, brief: '', status, blocked: false, blockedReason: null, createdAt: '', updatedAt: '', column: status === 'rejected' ? 'rejected' : status, ...over,
} as ProjectView);

const task = (over: Partial<Task>): Task => ({
  id: 't1', projectId: 'p1', parentId: null, phase: 'delivery', assigneeId: 'cto', assignedById: 'ceo', title: 'T', instructions: '',
  status: 'queued', feedback: null, reworkCount: 0, resultSummary: null, resultFiles: [], attachments: [], failureReason: null,
  crossTeamRequestId: null, createdAt: '', updatedAt: '', ...over,
});

const approval = (over: Partial<Approval> = {}): Approval => ({
  id: 'a1', projectId: 'p1', taskId: 't1', agentId: 'outreach-writer', kind: 'email', destination: 'x', subject: null, content: 'c',
  files: [], status: 'pending', ceoRecommendation: null, ceoNote: null, founderEdit: null, decidedAt: null, createdAt: '', ...over,
});

const base = (): UiState => ({
  companyName: 'HQ', departments: [...DEPARTMENTS], agents: ROSTER.map(a => ({ ...a, state: 'idle' as const, currentTaskId: null })),
  projects: [project('p1', 'in_progress')], tasks: [task({ status: 'running' })], pendingApprovals: [], pausedUntil: null, chat: [],
});

test('reduce applies task.updated and recomputes the column', () => {
  const s = reduce(base(), { type: 'task.updated', task: task({ status: 'in_review' }), prev: 'running' });
  expect(s.tasks[0].status).toBe('in_review');
  expect(s.projects[0].column).toBe('ceo_review');
});

test('reduce adds approval and counts pending', () => {
  let s = reduce(base(), { type: 'approval.created', approval: approval() });
  expect(s.pendingApprovals).toHaveLength(1);
  expect(inboxCount(s)).toBe(1);
  s = reduce(s, { type: 'approval.updated', approval: approval({ status: 'approved' }) });
  expect(s.pendingApprovals).toHaveLength(0);
});

test('company.paused sets pausedUntil', () => {
  const s = reduce(base(), { type: 'company.paused', until: '2026-11-07T19:00:00Z' });
  expect(s.pausedUntil).toBe('2026-11-07T19:00:00Z');
  expect(reduce(s, { type: 'company.paused', until: null }).pausedUntil).toBeNull();
});

test('run.updated marks the agent working, then idle', () => {
  const run = { id: 'r', agentId: 'cto', taskId: 't1', projectId: 'p1', purpose: 'work' as const, status: 'running' as const, sessionId: null, costUsd: 0, error: null, payload: {}, createdAt: '', startedAt: '', endedAt: null };
  let s = reduce(base(), { type: 'run.updated', run });
  expect(s.agents.find(a => a.id === 'cto')!.state).toBe('working');
  s = reduce(s, { type: 'run.updated', run: { ...run, status: 'succeeded' } });
  expect(s.agents.find(a => a.id === 'cto')!.state).toBe('idle');
});

test('inbox counts blocked projects and founder decisions', () => {
  const s = { ...base(), projects: [project('a', 'awaiting_approval'), project('b', 'awaiting_founder'), project('c', 'conception', { blocked: true }), project('d', 'budgeting')] };
  expect(inboxCount(s)).toBe(3);
});

test('groupByColumn returns all 10 columns in order even when empty', () => {
  const g = groupByColumn([project('x', 'done'), project('y', 'rejected')]);
  expect(Object.keys(g)).toEqual(['idea', 'sharpening', 'conception', 'budgeting', 'awaiting_approval', 'in_progress', 'lead_review', 'ceo_review', 'awaiting_founder', 'done']);
  expect(g.done.map(p => p.id)).toEqual(['x']);
  expect(g.idea).toEqual([]);
});
