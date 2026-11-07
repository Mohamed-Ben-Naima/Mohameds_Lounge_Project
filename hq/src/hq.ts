// Wires the whole company together. Used by main.ts, the API tests and the probe.
import path from 'node:path';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { openDb, type Db } from './db/db.ts';
import { EventBus } from './events/bus.ts';
import { Company } from './domain/company.ts';
import { Workspaces } from './workspace/workspaces.ts';
import { TokenRegistry } from './orchestrator/tokens.ts';
import { RunQueue } from './orchestrator/queue.ts';
import { Orchestrator } from './orchestrator/orchestrator.ts';
import { ChatService } from './ceo/chat.ts';
import { ClaudeRunner } from './runner/process.ts';
import type { AgentRunner } from './runner/types.ts';
import { buildApp } from './http/app.ts';
import { HQ_ROOT, type Config } from './config.ts';

export interface Hq {
  config: Config;
  db: Db;
  bus: EventBus;
  company: Company;
  ws: Workspaces;
  tokens: TokenRegistry;
  queue: RunQueue;
  orchestrator: Orchestrator;
  chat: ChatService;
  app: FastifyInstance;
  url: () => string;
}

export function createHq(opts: { config: Config; runner?: (h: { company: Company; tokens: TokenRegistry; url: () => string }) => AgentRunner; now?: () => Date }): Hq {
  const { config } = opts;
  const now = opts.now ?? (() => new Date());
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = openDb(path.join(config.dataDir, 'hq.sqlite'));
  const bus = new EventBus();
  const ws = new Workspaces(config.dataDir);
  ws.ensureAll();
  const company = new Company(db, bus, ws);
  const tokens = new TokenRegistry();
  const queue = new RunQueue(db, bus, { maxWork: config.maxWorkRuns, now });

  let boundPort = config.port;
  const url = () => `http://127.0.0.1:${boundPort}`;
  const runner = opts.runner
    ? opts.runner({ company, tokens, url })
    : new ClaudeRunner({
      claudePath: config.claudePath, hqUrl: url, timeoutMs: config.runTimeoutMs, companyName: config.companyName,
      mcpEntry: path.join(HQ_ROOT, 'src', 'mcp', 'server.ts'),
      hookScript: path.join(HQ_ROOT, 'src', 'gate', 'egress-hook.mjs'),
      runsDir: path.join(config.dataDir, 'runs'),
    });

  const orchestrator = new Orchestrator({ db, bus, company, queue, ws, tokens, runner, config, now });
  const chat = new ChatService(db, bus, queue, () => orchestrator.pump());
  const app = buildApp({ config, db, bus, company, queue, ws, tokens, chat, pump: () => orchestrator.pump() });
  app.addHook('onListen', async () => {
    const addr = app.server.address();
    if (addr && typeof addr === 'object') boundPort = addr.port;
  });

  queue.recoverOrphans();
  orchestrator.start();
  return { config, db, bus, company, ws, tokens, queue, orchestrator, chat, app, url };
}
