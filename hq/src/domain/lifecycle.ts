// Which status changes are allowed, and which board column a project shows in.
import type { Project, ProjectStatus, Role, Task, TaskStatus } from '../types.ts';
import { PolicyError } from './errors.ts';

const PROJECT_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  idea: ['sharpening', 'rejected'],
  sharpening: ['conception', 'rejected'],
  conception: ['budgeting', 'rejected'],
  budgeting: ['awaiting_approval', 'rejected'],
  awaiting_approval: ['in_progress', 'sharpening', 'rejected'],
  in_progress: ['awaiting_founder', 'rejected'],
  awaiting_founder: ['done', 'in_progress', 'rejected'],
  done: [],
  rejected: [],
};

const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  queued: ['running'],
  running: ['in_review', 'waiting_subtasks', 'failed', 'queued', 'done'],
  waiting_subtasks: ['running', 'failed'],
  in_review: ['done', 'rework', 'failed'],
  rework: ['running', 'queued'],
  done: [],
  failed: [],
};

export function assertProjectTransition(from: ProjectStatus, to: ProjectStatus): void {
  if (!PROJECT_TRANSITIONS[from].includes(to)) {
    throw new PolicyError('bad_transition', `A project cannot move from ${from} to ${to}.`);
  }
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!TASK_TRANSITIONS[from].includes(to)) {
    throw new PolicyError('bad_transition', `A task cannot move from ${from} to ${to}.`);
  }
}

export const isTerminal = (s: TaskStatus) => s === 'done' || s === 'failed';

export type BoardColumn =
  | 'idea' | 'sharpening' | 'conception' | 'budgeting' | 'awaiting_approval'
  | 'in_progress' | 'lead_review' | 'ceo_review' | 'awaiting_founder' | 'done';

export const BOARD_COLUMNS: { id: BoardColumn; label: string }[] = [
  { id: 'idea', label: 'Ideas' },
  { id: 'sharpening', label: 'Sharpening' },
  { id: 'conception', label: 'Conception' },
  { id: 'budgeting', label: 'Budgeting' },
  { id: 'awaiting_approval', label: 'Needs your OK (plan)' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'lead_review', label: 'Lead review' },
  { id: 'ceo_review', label: 'CEO review' },
  { id: 'awaiting_founder', label: 'Needs your OK (delivery)' },
  { id: 'done', label: 'Done' },
];

const ACTIVE: TaskStatus[] = ['queued', 'running', 'rework', 'waiting_subtasks'];

export function boardColumnOf(project: Project, tasks: Task[], roleOf: (agentId: string) => Role): BoardColumn | 'rejected' {
  if (project.status !== 'in_progress') return project.status;
  const work = tasks.filter(t => t.phase === 'delivery' || t.phase === 'report');
  if (work.some(t => ACTIVE.includes(t.status))) return 'in_progress';
  if (work.some(t => t.status === 'in_review' && roleOf(t.assigneeId) === 'specialist')) return 'lead_review';
  if (work.some(t => t.status === 'in_review' && roleOf(t.assigneeId) === 'lead')) return 'ceo_review';
  return 'in_progress';
}
