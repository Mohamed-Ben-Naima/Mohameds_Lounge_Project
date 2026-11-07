import type { Db } from '../db.ts';

export function get(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function set(db: Db, key: string, value: string | null): void {
  if (value === null) db.prepare('DELETE FROM kv WHERE key = ?').run(key);
  else db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
