import type { CrossTeamRequest, DeptId } from '../../types.ts';
import { type Db, newId, nowIso, table } from '../db.ts';

const t = table<CrossTeamRequest>('cross_team_requests');

export function create(db: Db, input: { projectId: string; fromAgentId: string; targetDept: DeptId; need: string }): CrossTeamRequest {
  return t.insert(db, { id: newId('ctr'), ...input, status: 'open', resolution: null, createdAt: nowIso() });
}
export const get = (db: Db, id: string) => t.get(db, id);
export const update = (db: Db, id: string, patch: Partial<CrossTeamRequest>) => t.update(db, id, patch);
