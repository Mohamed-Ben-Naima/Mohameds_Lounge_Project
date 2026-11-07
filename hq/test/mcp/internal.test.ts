import { afterEach, beforeEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb, type Db } from '../../src/db/db.ts';
import * as tasks from '../../src/db/repos/tasks.ts';
import * as projects from '../../src/db/repos/projects.ts';
import { EventBus } from '../../src/events/bus.ts';
import { Company, type CallerCtx } from '../../src/domain/company.ts';
import { Workspaces } from '../../src/workspace/workspaces.ts';
import { TokenRegistry } from '../../src/orchestrator/tokens.ts';
import { internalRoutes } from '../../src/http/internalRoutes.ts';

let app: FastifyInstance;
let db: Db;
let tokens: TokenRegistry;

beforeEach(async () => {
  db = openDb(':memory:');
  const ws = new Workspaces(fs.mkdtempSync(path.join(os.tmpdir(), 'hq-mcp-')));
  ws.ensureAll();
  const company = new Company(db, new EventBus(), ws);
  tokens = new TokenRegistry();
  app = Fastify();
  await app.register(internalRoutes({ company, tokens }));
});
afterEach(() => app.close());

function tokenFor(agentId: string, status: 'running' = 'running') {
  const p = projects.create(db, { title: 'P', brief: '', status: 'in_progress' });
  const assignedBy = agentId === 'cto' || agentId === 'cfo' ? 'ceo' : 'cto';
  const t = tasks.update(db, tasks.create(db, { projectId: p.id, parentId: null, phase: 'delivery', assigneeId: agentId, assignedById: assignedBy, title: 'T', instructions: 'I' }).id, { status });
  const ctx: CallerCtx = { agentId, runId: 'r', taskId: t.id, projectId: p.id, purpose: 'work', crossTeamRequestId: null };
  return { token: tokens.mint(ctx), task: t };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

test('no token → 401', async () => {
  expect((await app.inject({ method: 'GET', url: '/internal/tools' })).statusCode).toBe(401);
  expect((await app.inject({ method: 'GET', url: '/internal/tools', headers: auth('nope') })).statusCode).toBe(401);
});

test('specialist sees exactly get_task, submit_result, request_outbound', async () => {
  const { token } = tokenFor('qa-engineer');
  const r = await app.inject({ method: 'GET', url: '/internal/tools', headers: auth(token) });
  expect(r.statusCode).toBe(200);
  const tools = r.json() as { name: string; inputSchema: { type: string } }[];
  expect(tools.map(t => t.name)).toEqual(['get_task', 'submit_result', 'request_outbound']);
  expect(tools[1].inputSchema.type).toBe('object');
});

test('cfo sees set_budget', async () => {
  const { token } = tokenFor('cfo');
  const names = (await app.inject({ method: 'GET', url: '/internal/tools', headers: auth(token) })).json().map((t: any) => t.name);
  expect(names).toContain('set_budget');
});

test('specialist calling create_subtask → 403 not_allowed', async () => {
  const { token } = tokenFor('qa-engineer');
  const r = await app.inject({ method: 'POST', url: '/internal/tool/create_subtask', headers: auth(token), payload: { args: { assigneeId: 'x', title: 't', instructions: 'i' } } });
  expect(r.statusCode).toBe(403);
  expect(r.json().code).toBe('not_allowed');
});

test('bad args → 400', async () => {
  const { token } = tokenFor('qa-engineer');
  const r = await app.inject({ method: 'POST', url: '/internal/tool/submit_result', headers: auth(token), payload: { args: { summary: 5 } } });
  expect(r.statusCode).toBe(400);
});

test('revoked token → 401', async () => {
  const { token } = tokenFor('qa-engineer');
  tokens.revoke(token);
  expect((await app.inject({ method: 'GET', url: '/internal/tools', headers: auth(token) })).statusCode).toBe(401);
});

test('policy refusal surfaces code', async () => {
  const { token } = tokenFor('cto');
  const r = await app.inject({ method: 'POST', url: '/internal/tool/create_subtask', headers: auth(token), payload: { args: { assigneeId: 'pentester', title: 't', instructions: 'i' } } });
  expect(r.statusCode).toBe(403);
  expect(r.json().code).toBe('not_your_report');
});

test('successful call returns result', async () => {
  const { token, task } = tokenFor('qa-engineer');
  const r = await app.inject({ method: 'POST', url: '/internal/tool/get_task', headers: auth(token), payload: { args: {} } });
  expect(r.statusCode).toBe(200);
  expect(r.json().result.task.id).toBe(task.id);
});
