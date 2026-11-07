import type { Budget } from '../../types.ts';
import { type Db, nowIso, table } from '../db.ts';

const t = table<Budget>('budgets', { json: ['externalCosts', 'clientPrice'], key: 'projectId' });

export function upsert(db: Db, input: Omit<Budget, 'updatedAt'>): Budget {
  const row = { ...input, updatedAt: nowIso() };
  if (t.get(db, input.projectId)) return t.update(db, input.projectId, row);
  return t.insert(db, row);
}
export const get = (db: Db, projectId: string) => t.get(db, projectId);
