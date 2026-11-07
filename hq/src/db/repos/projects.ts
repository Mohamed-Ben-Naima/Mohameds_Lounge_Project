import type { Project, ProjectStatus } from '../../types.ts';
import { type Db, newId, nowIso, table } from '../db.ts';

const t = table<Project>('projects', { bool: ['blocked'] });

export function create(db: Db, input: { title: string; brief: string; status: ProjectStatus }): Project {
  const at = nowIso();
  return t.insert(db, { id: newId('prj'), ...input, blocked: false, blockedReason: null, createdAt: at, updatedAt: at });
}
export const get = (db: Db, id: string) => t.get(db, id);
export const list = (db: Db) => t.select(db, 'ORDER BY rowid');
export const update = (db: Db, id: string, patch: Partial<Project>) => t.update(db, id, { ...patch, updatedAt: nowIso() });
