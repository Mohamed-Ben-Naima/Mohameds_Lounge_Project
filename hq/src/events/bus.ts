// Every change in the company is announced here. The office and board react to these, nothing else.
import type { Approval, Budget, ChatMessage, CrossTeamRequest, Project, Run, Task, TaskStatus } from '../types.ts';

export type CompanyEvent =
  | { type: 'project.updated'; project: Project }
  | { type: 'task.created'; task: Task }
  | { type: 'task.updated'; task: Task; prev: TaskStatus }
  | { type: 'approval.created'; approval: Approval }
  | { type: 'approval.updated'; approval: Approval }
  | { type: 'crossteam.created'; request: CrossTeamRequest }
  | { type: 'budget.updated'; budget: Budget }
  | { type: 'run.updated'; run: Run }
  | { type: 'run.activity'; runId: string; agentId: string; tool: string }
  | { type: 'chat.message'; message: ChatMessage }
  | { type: 'company.paused'; until: string | null };

export class EventBus {
  private listeners = new Set<(e: CompanyEvent) => void>();

  emit(e: CompanyEvent): void {
    for (const fn of [...this.listeners]) fn(e);
  }

  on(fn: (e: CompanyEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
