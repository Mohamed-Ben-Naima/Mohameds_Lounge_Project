import { expect, test } from 'vitest';
import { assertProjectTransition, assertTaskTransition, boardColumnOf, BOARD_COLUMNS } from '../../src/domain/lifecycle.ts';
import { PolicyError } from '../../src/domain/errors.ts';
import { getAgent } from '../../src/org/roster.ts';
import type { Project, ProjectStatus, Task, TaskStatus } from '../../src/types.ts';

const roleOf = (id: string) => getAgent(id).role;
const project = (status: ProjectStatus): Project => ({ id: 'p', title: 't', brief: '', status, blocked: false, blockedReason: null, createdAt: '', updatedAt: '' });
const task = (assigneeId: string, status: TaskStatus, phase: Task['phase'] = 'delivery'): Task => ({
  id: Math.random().toString(), projectId: 'p', parentId: null, phase, assigneeId, assignedById: 'ceo', title: '', instructions: '',
  status, feedback: null, reworkCount: 0, resultSummary: null, resultFiles: [], attachments: [], failureReason: null,
  crossTeamRequestId: null, createdAt: '', updatedAt: '',
});

test('allowed project transitions pass', () => {
  const pairs: [ProjectStatus, ProjectStatus][] = [
    ['idea', 'sharpening'], ['idea', 'rejected'], ['sharpening', 'conception'], ['sharpening', 'rejected'],
    ['conception', 'budgeting'], ['budgeting', 'awaiting_approval'], ['awaiting_approval', 'in_progress'],
    ['awaiting_approval', 'sharpening'], ['awaiting_approval', 'rejected'], ['in_progress', 'awaiting_founder'],
    ['awaiting_founder', 'done'], ['awaiting_founder', 'in_progress'],
  ];
  for (const [a, b] of pairs) expect(() => assertProjectTransition(a, b)).not.toThrow();
});

test('conception→done throws bad_transition', () => {
  try { assertProjectTransition('conception', 'done'); expect.unreachable(); }
  catch (e) { expect(e).toBeInstanceOf(PolicyError); expect((e as PolicyError).code).toBe('bad_transition'); }
});

test('done task cannot move', () => {
  expect(() => assertTaskTransition('done', 'running')).toThrow(PolicyError);
  expect(() => assertTaskTransition('failed', 'queued')).toThrow(PolicyError);
  expect(() => assertTaskTransition('running', 'queued')).not.toThrow();
  expect(() => assertTaskTransition('in_review', 'rework')).not.toThrow();
});

test('boardColumnOf: running delivery task → in_progress', () => {
  expect(boardColumnOf(project('in_progress'), [task('cto', 'running'), task('qa-engineer', 'in_review')], roleOf)).toBe('in_progress');
});

test('only specialist in_review left → lead_review', () => {
  expect(boardColumnOf(project('in_progress'), [task('qa-engineer', 'in_review'), task('cto', 'done')], roleOf)).toBe('lead_review');
});

test('only lead in_review left → ceo_review', () => {
  expect(boardColumnOf(project('in_progress'), [task('cto', 'in_review'), task('qa-engineer', 'done')], roleOf)).toBe('ceo_review');
});

test('budgeting maps to budgeting, rejected to rejected', () => {
  expect(boardColumnOf(project('budgeting'), [], roleOf)).toBe('budgeting');
  expect(boardColumnOf(project('rejected'), [], roleOf)).toBe('rejected');
});

test('BOARD_COLUMNS has 10 entries in order', () => {
  expect(BOARD_COLUMNS.map(c => c.id)).toEqual([
    'idea', 'sharpening', 'conception', 'budgeting', 'awaiting_approval', 'in_progress', 'lead_review', 'ceo_review', 'awaiting_founder', 'done',
  ]);
  expect(BOARD_COLUMNS[4].label).toBe('Needs your OK (plan)');
});
