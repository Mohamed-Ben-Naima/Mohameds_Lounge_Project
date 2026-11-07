// Who may give work to whom. Work goes down the chart; results come up.
import type { AgentDef, DeptId } from '../types.ts';
import { DEPARTMENTS, ROSTER, findAgent, getAgent } from './roster.ts';

export function directReports(id: string): AgentDef[] {
  return ROSTER.filter(a => a.leadId === id);
}

export function reviewerOf(id: string): string | null {
  return getAgent(id).leadId;
}

export function canAssign(fromId: string, toId: string): boolean {
  const from = findAgent(fromId);
  const to = findAgent(toId);
  if (!from || !to) return false;
  if (from.role === 'ceo') return to.role === 'lead';
  if (from.role === 'lead') return to.role === 'specialist' && to.leadId === from.id;
  return false;
}

export function leadOfDept(dept: DeptId): AgentDef {
  const d = DEPARTMENTS.find(x => x.id === dept);
  if (!d) throw new Error(`unknown department ${dept}`);
  return getAgent(d.leadId);
}
