import type { Run, RunPurpose, RunStatus } from '../../types.ts';
import { type Db, newId, nowIso, table } from '../db.ts';

const t = table<Run>('runs', { json: ['payload'] });

export function create(db: Db, input: { agentId: string; purpose: RunPurpose; taskId: string | null; projectId: string | null; payload: Record<string, unknown> }): Run {
  return t.insert(db, {
    id: newId('run'), ...input, status: 'queued', sessionId: null, costUsd: 0, error: null,
    createdAt: nowIso(), startedAt: null, endedAt: null,
  });
}
export const get = (db: Db, id: string) => t.get(db, id);
export const update = (db: Db, id: string, patch: Partial<Run>) => t.update(db, id, patch);
export const listByStatus = (db: Db, status: RunStatus) => t.select(db, 'WHERE status = ? ORDER BY rowid', status);
export const listByAgent = (db: Db, agentId: string, limit: number) => t.select(db, 'WHERE agent_id = ? ORDER BY rowid DESC LIMIT ?', agentId, limit);
export const listByProject = (db: Db, projectId: string) => t.select(db, 'WHERE project_id = ? ORDER BY rowid', projectId);
export function sumCostByProject(db: Db, projectId: string): number {
  const row = db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM runs WHERE project_id = ?').get(projectId) as { s: number };
  return row.s;
}
