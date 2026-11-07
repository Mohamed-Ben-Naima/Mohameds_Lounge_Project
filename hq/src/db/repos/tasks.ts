import type { Phase, Task } from '../../types.ts';
import { type Db, newId, nowIso, table } from '../db.ts';

const t = table<Task>('tasks', { json: ['resultFiles', 'attachments'] });

export interface NewTask {
  projectId: string;
  parentId: string | null;
  phase: Phase;
  assigneeId: string;
  assignedById: string;
  title: string;
  instructions: string;
  attachments?: string[];
  crossTeamRequestId?: string | null;
}

export function create(db: Db, input: NewTask): Task {
  const at = nowIso();
  return t.insert(db, {
    id: newId('tsk'), ...input, attachments: input.attachments ?? [], crossTeamRequestId: input.crossTeamRequestId ?? null,
    status: 'queued', feedback: null, reworkCount: 0, resultSummary: null, resultFiles: [], failureReason: null,
    createdAt: at, updatedAt: at,
  });
}
export const get = (db: Db, id: string) => t.get(db, id);
export const listAll = (db: Db) => t.select(db, 'ORDER BY rowid');
export const listByProject = (db: Db, projectId: string) => t.select(db, 'WHERE project_id = ? ORDER BY rowid', projectId);
export const listChildren = (db: Db, parentId: string) => t.select(db, 'WHERE parent_id = ? ORDER BY rowid', parentId);
export const listByStatus = (db: Db, status: Task['status']) => t.select(db, 'WHERE status = ? ORDER BY rowid', status);
export const update = (db: Db, id: string, patch: Partial<Task>) => t.update(db, id, { ...patch, updatedAt: nowIso() });
