// SQLite database: schema, ids, and a small row-mapping helper shared by the repos.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, brief TEXT NOT NULL, status TEXT NOT NULL,
  blocked INTEGER NOT NULL DEFAULT 0, blocked_reason TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cross_team_requests (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), from_agent_id TEXT NOT NULL,
  target_dept TEXT NOT NULL, need TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', resolution TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), parent_id TEXT REFERENCES tasks(id),
  phase TEXT NOT NULL, assignee_id TEXT NOT NULL, assigned_by_id TEXT NOT NULL,
  title TEXT NOT NULL, instructions TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
  feedback TEXT, rework_count INTEGER NOT NULL DEFAULT 0, result_summary TEXT,
  result_files TEXT NOT NULL DEFAULT '[]', attachments TEXT NOT NULL DEFAULT '[]',
  failure_reason TEXT, cross_team_request_id TEXT REFERENCES cross_team_requests(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, task_id TEXT REFERENCES tasks(id), project_id TEXT REFERENCES projects(id),
  purpose TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', session_id TEXT, cost_usd REAL NOT NULL DEFAULT 0,
  error TEXT, payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, started_at TEXT, ended_at TEXT
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), task_id TEXT NOT NULL REFERENCES tasks(id),
  agent_id TEXT NOT NULL, kind TEXT NOT NULL, destination TEXT NOT NULL, subject TEXT, content TEXT NOT NULL,
  files TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending', ceo_recommendation TEXT, ceo_note TEXT,
  founder_edit TEXT, decided_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS budgets (
  project_id TEXT PRIMARY KEY REFERENCES projects(id), estimated_runs INTEGER NOT NULL, estimated_ai_usd REAL NOT NULL,
  external_costs TEXT NOT NULL DEFAULT '[]', client_price TEXT, notes TEXT NOT NULL, set_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL,
  entity TEXT NOT NULL, entity_id TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY, role TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

const snake = (k: string) => k.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

type SqlValue = string | number | null;

/** Maps camelCase row objects to snake_case columns, with JSON and boolean columns. */
export function table<T extends object>(name: string, opts: { json?: (keyof T)[]; bool?: (keyof T)[]; key?: keyof T } = {}) {
  const json = new Set((opts.json ?? []) as string[]);
  const bool = new Set((opts.bool ?? []) as string[]);
  const key = snake((opts.key as string) ?? 'id');

  const toCol = (k: string, v: unknown): SqlValue => {
    if (json.has(k)) return v === null || v === undefined ? null : JSON.stringify(v);
    if (bool.has(k)) return v ? 1 : 0;
    return (v ?? null) as SqlValue;
  };
  const fromRow = (row: Record<string, unknown> | undefined): T | null => {
    if (!row) return null;
    const out: Record<string, unknown> = {};
    for (const [col, v] of Object.entries(row)) {
      const k = camel(col);
      out[k] = json.has(k) ? (v === null ? null : JSON.parse(v as string)) : bool.has(k) ? v === 1 : v;
    }
    return out as T;
  };

  return {
    insert(db: Db, row: T): T {
      const entries = Object.entries(row).filter(([, v]) => v !== undefined);
      const cols = entries.map(([k]) => snake(k));
      db.prepare(`INSERT INTO ${name} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
        .run(...entries.map(([k, v]) => toCol(k, v)));
      return row;
    },
    get(db: Db, id: string | number): T | null {
      return fromRow(db.prepare(`SELECT * FROM ${name} WHERE ${key} = ?`).get(id) as Record<string, unknown> | undefined);
    },
    update(db: Db, id: string, patch: Partial<T>): T {
      const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
      if (entries.length) {
        db.prepare(`UPDATE ${name} SET ${entries.map(([k]) => `${snake(k)} = ?`).join(', ')} WHERE ${key} = ?`)
          .run(...entries.map(([k, v]) => toCol(k, v)), id);
      }
      const row = this.get(db, id);
      if (!row) throw new Error(`${name} ${id} not found`);
      return row;
    },
    select(db: Db, where: string, ...params: SqlValue[]): T[] {
      return (db.prepare(`SELECT * FROM ${name} ${where}`).all(...params) as Record<string, unknown>[])
        .map(r => fromRow(r) as T);
    },
  };
}
