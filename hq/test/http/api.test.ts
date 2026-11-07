import { afterEach, beforeEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHq, type Hq } from '../../src/hq.ts';
import { loadConfig } from '../../src/config.ts';
import * as runs from '../../src/db/repos/runs.ts';
import * as tasks from '../../src/db/repos/tasks.ts';
import * as projects from '../../src/db/repos/projects.ts';
import * as approvals from '../../src/db/repos/approvals.ts';
import { ScriptedRunner } from '../support/scriptedRunner.ts';

let hq: Hq;
beforeEach(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-api-'));
  hq = createHq({
    config: { ...loadConfig({}), dataDir },
    runner: ({ company, tokens }) => new ScriptedRunner(company, tokens, { 'ceo:chat': () => ({ finalText: 'Hello founder' }) }),
  });
  await hq.app.ready();
});
afterEach(() => hq.app.close());

const post = (url: string, payload: object = {}) => hq.app.inject({ method: 'POST', url, payload });

test('accept-brief moves sharpening to conception', async () => {
  const p = hq.company.founderAddProject({ title: 'P', brief: 'b', status: 'sharpening' });
  const r = await post(`/api/projects/${p.id}/accept-brief`);
  expect(r.statusCode).toBe(200);
  expect(projects.get(hq.db, p.id)!.status).toBe('conception');
});

test('accept-brief twice returns 409', async () => {
  const p = hq.company.founderAddProject({ title: 'P', brief: 'b', status: 'sharpening' });
  await post(`/api/projects/${p.id}/accept-brief`);
  expect((await post(`/api/projects/${p.id}/accept-brief`)).statusCode).toBe(409);
});

test('deciding an approval twice returns 409', async () => {
  const p = projects.create(hq.db, { title: 'P', brief: '', status: 'in_progress' });
  const t = tasks.create(hq.db, { projectId: p.id, parentId: null, phase: 'delivery', assigneeId: 'outreach-writer', assignedById: 'cro', title: 't', instructions: 'i' });
  const a = approvals.create(hq.db, { projectId: p.id, taskId: t.id, agentId: 'outreach-writer', kind: 'email', destination: 'x', subject: null, content: 'orig', files: [] });
  expect((await post(`/api/approvals/${a.id}`, { decision: 'approve', editedContent: 'edited' })).statusCode).toBe(200);
  expect((await post(`/api/approvals/${a.id}`, { decision: 'approve', editedContent: 'second' })).statusCode).toBe(409);
  expect(approvals.get(hq.db, a.id)!.founderEdit).toBe('edited');
});

test('chat POST enqueues a chat run for ceo', async () => {
  const r = await post('/api/chat', { text: 'Hi CEO' });
  expect(r.statusCode).toBe(200);
  await hq.orchestrator.idle();
  const chatRuns = runs.listByAgent(hq.db, 'ceo', 10).filter(x => x.purpose === 'chat');
  expect(chatRuns).toHaveLength(1);
  const msgs = (await hq.app.inject({ method: 'GET', url: '/api/chat' })).json();
  expect(msgs.map((m: any) => m.role)).toEqual(['founder', 'ceo']);
  expect(msgs[1].text).toBe('Hello founder');
});

test('founder profile roundtrip', async () => {
  const put = await hq.app.inject({ method: 'PUT', url: '/api/founder-profile', payload: { text: '# Prefers short reports' } });
  expect(put.statusCode).toBe(200);
  expect((await hq.app.inject({ method: 'GET', url: '/api/founder-profile' })).json().text).toBe('# Prefers short reports');
});

test('files outside projects → 403', async () => {
  const r = await hq.app.inject({ method: 'GET', url: `/api/files?path=${encodeURIComponent(hq.ws.notesPath('ceo'))}` });
  expect(r.statusCode).toBe(403);
});

test('state lists 33 agents and 10-column projects', async () => {
  hq.company.founderAddProject({ title: 'P', brief: 'b', status: 'sharpening' });
  const s = (await hq.app.inject({ method: 'GET', url: '/api/state' })).json();
  expect(s.agents).toHaveLength(33);
  expect(s.agents[0]).toHaveProperty('state');
  expect(s.departments).toHaveLength(8);
  expect(s.projects[0].column).toBe('sharpening');
  expect(s.companyName).toBe('HQ');
});

test('unknown project returns 404', async () => {
  expect((await post('/api/projects/prj_nope/accept-brief')).statusCode).toBe(404);
});

test('config host is always 127.0.0.1', () => {
  expect(loadConfig({ HQ_HOST: '0.0.0.0' }).host).toBe('127.0.0.1');
});
