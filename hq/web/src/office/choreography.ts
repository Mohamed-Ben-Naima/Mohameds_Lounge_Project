// The only source of motion in the office: each real company event maps to at most a few moves.
// If nothing happened, nobody moves.
import type { CompanyEvent } from '../../../src/events/bus.ts';

export type Move = { agentId: string; to: 'desk' | 'board' | 'founder' | { desk: string }; thenReturn: boolean };
export type Mood = { agentId: string; anim?: 'idle' | 'typing'; bubble?: '?' | 'zzz' | null };
export interface Lookup { reviewerOf(id: string): string | null; agentIds: string[] }

const none = () => ({ moves: [] as Move[], moods: [] as Mood[] });

export function react(e: CompanyEvent, lookup: Lookup): { moves: Move[]; moods: Mood[] } {
  const out = none();
  switch (e.type) {
    case 'task.created':
      out.moves.push({ agentId: e.task.assignedById, to: 'board', thenReturn: true });
      break;
    case 'run.updated':
      if (e.run.status === 'running') out.moods.push({ agentId: e.run.agentId, anim: 'typing', bubble: null });
      else if (e.run.status !== 'queued') out.moods.push({ agentId: e.run.agentId, anim: 'idle' });
      break;
    case 'task.updated':
      if (e.task.status === 'in_review') out.moves.push({ agentId: e.task.assigneeId, to: { desk: e.task.assignedById }, thenReturn: true });
      else if (e.task.status === 'failed') out.moods.push({ agentId: e.task.assigneeId, bubble: '?' });
      break;
    case 'approval.updated':
      if (e.approval.status === 'pending' && e.approval.ceoRecommendation) out.moves.push({ agentId: 'ceo', to: 'founder', thenReturn: true });
      break;
    case 'project.updated':
      if (e.project.blocked) out.moods.push({ agentId: 'ceo', bubble: '?' });
      break;
    case 'company.paused':
      for (const id of lookup.agentIds) out.moods.push({ agentId: id, bubble: e.until ? 'zzz' : null });
      break;
  }
  return out;
}
