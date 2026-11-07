import { expect, test } from 'vitest';
import { jobDescription, taskPrompt } from '../../src/runner/prompts.ts';
import { ROSTER, getAgent } from '../../src/org/roster.ts';
import type { Task } from '../../src/types.ts';

const task = (over: Partial<Task> = {}): Task => ({
  id: 'tsk_1', projectId: 'prj_1', parentId: null, phase: 'delivery', assigneeId: 'qa-engineer', assignedById: 'cto',
  title: 'Test the API', instructions: 'Write tests', status: 'running', feedback: null, reworkCount: 0, resultSummary: null,
  resultFiles: [], attachments: [], failureReason: null, crossTeamRequestId: null, createdAt: '', updatedAt: '', ...over,
});

test('pentester description forbids active testing', () => {
  expect(jobDescription(getAgent('pentester'), 'HQ')).toContain('Active testing is disabled');
});

test('cto description names its three reports', () => {
  const d = jobDescription(getAgent('cto'), 'HQ');
  for (const t of ['Software Engineer', 'Cloud & DevOps Engineer', 'QA Engineer']) expect(d).toContain(t);
  expect(d).toContain('request_cross_team');
});

test('every description mentions request_outbound and the reviewer', () => {
  for (const a of ROSTER) {
    const d = jobDescription(a, 'HQ');
    expect(d).toContain('request_outbound');
    expect(d).toContain('Reply in the language the founder used.');
  }
  expect(jobDescription(getAgent('qa-engineer'), 'HQ')).toContain('You take work only from CTO.');
});

test('review prompt names the task id and review_result', () => {
  const p = taskPrompt('review', { inboxFiles: [], reviewOf: { task: task({ status: 'in_review', resultSummary: 'All good' }), submitterTitle: 'QA Engineer', files: ['inbox/review-tsk_1/r.md'] } });
  expect(p).toContain('tsk_1');
  expect(p).toContain('review_result');
  expect(p).toContain('All good');
  expect(p).toContain('inbox/review-tsk_1/r.md');
});

test('rework prompt includes feedback', () => {
  const p = taskPrompt('work', { inboxFiles: [], task: task({ feedback: 'Add edge cases', reworkCount: 1 }) });
  expect(p).toContain('Your lead asked for changes:');
  expect(p).toContain('Add edge cases');
  expect(p).toContain('outbox/tsk_1/');
  expect(p).toContain('submit_result');
});

test('chat prompt carries the founder message and accept-brief guidance', () => {
  const p = taskPrompt('chat', { inboxFiles: [], founderMessage: 'Here is my idea', boardSummary: '(no projects)' });
  expect(p).toContain('Here is my idea');
  expect(p).toContain('Accept brief');
  expect(p).toContain('create_project');
});
