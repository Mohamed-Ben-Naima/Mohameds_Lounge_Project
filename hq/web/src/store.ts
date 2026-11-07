// Browser-side company state, kept current by applying server events. Pure functions only.
import type { CompanyEvent } from '../../src/events/bus.ts';
import { BOARD_COLUMNS, boardColumnOf, type BoardColumn } from '../../src/domain/lifecycle.ts';
import type { AgentDef, Approval, ChatMessage, Department, Project, Task } from '../../src/types.ts';

export type AgentState = 'idle' | 'working' | 'waiting' | 'blocked';
export type AgentView = AgentDef & { state: AgentState; currentTaskId: string | null };
export type ProjectView = Project & { column: BoardColumn | 'rejected' };

export interface UiState {
  companyName: string;
  departments: Department[];
  agents: AgentView[];
  projects: ProjectView[];
  tasks: Task[];
  pendingApprovals: Approval[];
  pausedUntil: string | null;
  chat: ChatMessage[];
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  return list.some(x => x.id === item.id) ? list.map(x => (x.id === item.id ? item : x)) : [...list, item];
}

function withColumns(s: UiState, projectIds: string[]): UiState {
  const roleOf = (id: string) => s.agents.find(a => a.id === id)?.role ?? 'specialist';
  return {
    ...s,
    projects: s.projects.map(p => projectIds.includes(p.id)
      ? { ...p, column: boardColumnOf(p, s.tasks.filter(t => t.projectId === p.id), roleOf) }
      : p),
  };
}

export function reduce(s: UiState, e: CompanyEvent): UiState {
  switch (e.type) {
    case 'project.updated':
      return withColumns({ ...s, projects: upsert(s.projects, { ...e.project, column: e.project.status as BoardColumn }) }, [e.project.id]);
    case 'task.created':
    case 'task.updated':
      return withColumns({ ...s, tasks: upsert(s.tasks, e.task) }, [e.task.projectId]);
    case 'approval.created':
      return { ...s, pendingApprovals: upsert(s.pendingApprovals, e.approval) };
    case 'approval.updated':
      return {
        ...s,
        pendingApprovals: e.approval.status === 'pending'
          ? upsert(s.pendingApprovals, e.approval)
          : s.pendingApprovals.filter(a => a.id !== e.approval.id),
      };
    case 'company.paused':
      return { ...s, pausedUntil: e.until };
    case 'run.updated': {
      const r = e.run;
      return {
        ...s,
        agents: s.agents.map(a => a.id !== r.agentId ? a
          : r.status === 'running' ? { ...a, state: 'working', currentTaskId: r.taskId ?? a.currentTaskId }
          : a.state === 'working' && r.status !== 'queued' ? { ...a, state: 'idle' } : a),
      };
    }
    case 'chat.message':
      return { ...s, chat: upsert(s.chat, e.message) };
    default:
      return s;
  }
}

/** Things that need the founder: approvals, plans/deliveries to sign off, blocked projects. */
export function inboxCount(s: UiState): number {
  const projects = s.projects.filter(p => p.status === 'awaiting_approval' || p.status === 'awaiting_founder' || p.blocked).length;
  return s.pendingApprovals.length + projects;
}

export function groupByColumn(projects: ProjectView[]): Record<BoardColumn, ProjectView[]> {
  const out = Object.fromEntries(BOARD_COLUMNS.map(c => [c.id, [] as ProjectView[]])) as Record<BoardColumn, ProjectView[]>;
  for (const p of projects) if (p.column !== 'rejected') out[p.column].push(p);
  return out;
}
