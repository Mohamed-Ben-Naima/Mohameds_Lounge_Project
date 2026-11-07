import type { Approval } from '../../types.ts';
import { type Db, newId, nowIso, table } from '../db.ts';

const t = table<Approval>('approvals', { json: ['files'] });

export function create(db: Db, input: Pick<Approval, 'projectId' | 'taskId' | 'agentId' | 'kind' | 'destination' | 'subject' | 'content' | 'files'>): Approval {
  return t.insert(db, {
    id: newId('apr'), ...input, status: 'pending', ceoRecommendation: null, ceoNote: null, founderEdit: null,
    decidedAt: null, createdAt: nowIso(),
  });
}
export const get = (db: Db, id: string) => t.get(db, id);
export const update = (db: Db, id: string, patch: Partial<Approval>) => t.update(db, id, patch);
export const listPending = (db: Db) => t.select(db, "WHERE status = 'pending' ORDER BY rowid");
export const listByProject = (db: Db, projectId: string) => t.select(db, 'WHERE project_id = ? ORDER BY rowid', projectId);
