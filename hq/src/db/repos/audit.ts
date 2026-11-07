import type { AuditEntry } from '../../types.ts';
import { type Db, nowIso, table } from '../db.ts';

const t = table<AuditEntry>('audit', { json: ['detail'] });

export function append(db: Db, e: Omit<AuditEntry, 'id' | 'at'>): void {
  db.prepare('INSERT INTO audit (at, actor_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)')
    .run(nowIso(), e.actorId, e.action, e.entity, e.entityId, JSON.stringify(e.detail));
}
export const list = (db: Db, limit: number) => t.select(db, 'ORDER BY id DESC LIMIT ?', limit);
export const listByActor = (db: Db, actorId: string, limit: number) => t.select(db, 'WHERE actor_id = ? ORDER BY id DESC LIMIT ?', actorId, limit);
export function count(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM audit').get() as { c: number }).c;
}
