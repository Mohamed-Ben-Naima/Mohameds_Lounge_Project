import { afterEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { openDb } from '../../src/db/db.ts';
import * as tasks from '../../src/db/repos/tasks.ts';
import * as projects from '../../src/db/repos/projects.ts';
import { EventBus } from '../../src/events/bus.ts';
import { Company } from '../../src/domain/company.ts';
import { Workspaces } from '../../src/workspace/workspaces.ts';
import { TokenRegistry } from '../../src/orchestrator/tokens.ts';
import { internalRoutes } from '../../src/http/internalRoutes.ts';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/mcp/server.ts');
let app: FastifyInstance | null = null;
let client: Client | null = null;
afterEach(async () => { await client?.close(); await app?.close(); });

test('mcp proxy lists caller tools and forwards calls', async () => {
  const db = openDb(':memory:');
  const ws = new Workspaces(fs.mkdtempSync(path.join(os.tmpdir(), 'hq-proxy-')));
  ws.ensureAll();
  const company = new Company(db, new EventBus(), ws);
  const tokens = new TokenRegistry();
  app = Fastify();
  await app.register(internalRoutes({ company, tokens }));
  await app.listen({ host: '127.0.0.1', port: 0 });
  const port = (app.server.address() as { port: number }).port;

  const p = projects.create(db, { title: 'P', brief: '', status: 'in_progress' });
  const t = tasks.update(db, tasks.create(db, { projectId: p.id, parentId: null, phase: 'delivery', assigneeId: 'trend-scout', assignedById: 'cmo', title: 'Scan', instructions: 'I' }).id, { status: 'running' });
  const token = tokens.mint({ agentId: 'trend-scout', runId: 'r', taskId: t.id, projectId: p.id, purpose: 'work', crossTeamRequestId: null });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', SERVER],
    env: { ...process.env, HQ_URL: `http://127.0.0.1:${port}`, HQ_RUN_TOKEN: token } as Record<string, string>,
  });
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(transport);
  const listed = await client.listTools();
  expect(listed.tools.map(x => x.name)).toEqual(['get_task', 'submit_result', 'request_outbound']);
  const res = await client.callTool({ name: 'get_task', arguments: {} });
  expect(res.isError).toBeFalsy();
  const text = (res.content as { type: string; text: string }[])[0].text;
  expect(JSON.parse(text).result.task.id).toBe(t.id);
  const refused = await client.callTool({ name: 'submit_result', arguments: { summary: 's', files: ['../ceo/notes.md'] } });
  expect(refused.isError).toBe(true);
}, 30000);
