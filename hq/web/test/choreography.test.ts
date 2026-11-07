import { expect, test } from 'vitest';
import { react } from '../src/office/choreography.ts';
import { ROSTER } from '../../src/org/roster.ts';
import { reviewerOf } from '../../src/org/hierarchy.ts';
import type { Task, Run, Project, Approval } from '../../src/types.ts';

const lookup = { reviewerOf, agentIds: ROSTER.map(a => a.id) };
const task = (over: Partial<Task>): Task => ({
  id: 't', projectId: 'p', parentId: null, phase: 'delivery', assigneeId: 'qa-engineer', assignedById: 'cto', title: '', instructions: '',
  status: 'queued', feedback: null, reworkCount: 0, resultSummary: null, resultFiles: [], attachments: [], failureReason: null,
  crossTeamRequestId: null, createdAt: '', updatedAt: '', ...over,
});
const run = (status: Run['status']): Run => ({ id: 'r', agentId: 'cto', taskId: 't', projectId: 'p', purpose: 'work', status, sessionId: null, costUsd: 0, error: null, payload: {}, createdAt: '', startedAt: null, endedAt: null });

test('react: task.created moves assigner to board and back', () => {
  expect(react({ type: 'task.created', task: task({}) }, lookup).moves).toEqual([{ agentId: 'cto', to: 'board', thenReturn: true }]);
});

test('react: in_review sends specialist to lead desk', () => {
  const r = react({ type: 'task.updated', task: task({ status: 'in_review' }), prev: 'running' }, lookup);
  expect(r.moves).toEqual([{ agentId: 'qa-engineer', to: { desk: 'cto' }, thenReturn: true }]);
});

test('react: lead in_review goes to ceo desk', () => {
  const r = react({ type: 'task.updated', task: task({ assigneeId: 'cto', assignedById: 'ceo', status: 'in_review' }), prev: 'running' }, lookup);
  expect(r.moves).toEqual([{ agentId: 'cto', to: { desk: 'ceo' }, thenReturn: true }]);
});

test('react: running run types, finished run idles', () => {
  expect(react({ type: 'run.updated', run: run('running') }, lookup).moods).toEqual([{ agentId: 'cto', anim: 'typing', bubble: null }]);
  expect(react({ type: 'run.updated', run: run('succeeded') }, lookup).moods).toEqual([{ agentId: 'cto', anim: 'idle' }]);
  expect(react({ type: 'run.updated', run: run('queued') }, lookup)).toEqual({ moves: [], moods: [] });
});

test('react: failed task shows ? for the assignee', () => {
  expect(react({ type: 'task.updated', task: task({ status: 'failed' }), prev: 'running' }, lookup).moods).toEqual([{ agentId: 'qa-engineer', bubble: '?' }]);
});

test('react: paused gives zzz to all, resume clears', () => {
  const p = react({ type: 'company.paused', until: '2026-11-07T19:00:00Z' }, lookup);
  expect(p.moods).toHaveLength(33);
  expect(p.moods.every(m => m.bubble === 'zzz')).toBe(true);
  expect(react({ type: 'company.paused', until: null }, lookup).moods.every(m => m.bubble === null)).toBe(true);
});

test('react: ceo recommendation walks the ceo to the founder', () => {
  const a = { id: 'a', status: 'pending', ceoRecommendation: 'approve' } as Approval;
  expect(react({ type: 'approval.updated', approval: a }, lookup).moves).toEqual([{ agentId: 'ceo', to: 'founder', thenReturn: true }]);
  expect(react({ type: 'approval.updated', approval: { ...a, status: 'approved' } }, lookup).moves).toEqual([]);
});

test('react: blocked project puts ? on the ceo', () => {
  const p = { id: 'p', blocked: true } as Project;
  expect(react({ type: 'project.updated', project: p }, lookup).moods).toEqual([{ agentId: 'ceo', bubble: '?' }]);
});

test('react: chat.message produces no moves', () => {
  expect(react({ type: 'chat.message', message: { id: 'm', role: 'founder', text: 'hi', at: '' } }, lookup)).toEqual({ moves: [], moods: [] });
});
