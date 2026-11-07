// HQ configuration from environment variables. The server always binds to 127.0.0.1.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HQ_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface Config {
  host: '127.0.0.1';
  port: number;
  dataDir: string;
  maxWorkRuns: number;
  model: string;
  ceoModel: string;
  companyName: string;
  claudePath: string;
  runTimeoutMs: number;
}

function int(v: string | undefined, fallback: number): number {
  const n = v === undefined ? NaN : Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  return {
    host: '127.0.0.1',
    port: int(env.HQ_PORT, 4600),
    dataDir: path.resolve(env.HQ_DATA_DIR ?? path.join(HQ_ROOT, 'data')),
    maxWorkRuns: int(env.HQ_MAX_RUNS, 1),
    model: env.HQ_MODEL || 'sonnet',
    ceoModel: env.HQ_CEO_MODEL || env.HQ_MODEL || 'sonnet',
    companyName: env.HQ_COMPANY_NAME || 'HQ',
    claudePath: env.HQ_CLAUDE_PATH || 'claude',
    runTimeoutMs: int(env.HQ_RUN_TIMEOUT_MS, 1_200_000),
  };
}
