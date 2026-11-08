import { beforeEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspaces } from '../../src/workspace/workspaces.ts';
import { PolicyError } from '../../src/domain/errors.ts';

let root: string;
let ws: Workspaces;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-ws-'));
  ws = new Workspaces(root);
});

function writeOutbox(agentId: string, rel: string, content = 'x') {
  const abs = path.join(ws.dirOf(agentId), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

function expectBadPath(fn: () => unknown) {
  try { fn(); expect.unreachable(); }
  catch (e) { expect(e).toBeInstanceOf(PolicyError); expect((e as PolicyError).code).toBe('bad_path'); }
}

test('ensure creates notes inbox outbox', () => {
  ws.ensure('cto');
  const dir = ws.dirOf('cto');
  expect(fs.readFileSync(path.join(dir, 'notes.md'), 'utf8')).toBe('# Notes — CTO\n');
  expect(fs.statSync(path.join(dir, 'inbox')).isDirectory()).toBe(true);
  expect(fs.statSync(path.join(dir, 'outbox')).isDirectory()).toBe(true);
});

test('ensure does not overwrite existing notes', () => {
  ws.ensure('cto');
  fs.writeFileSync(ws.notesPath('cto'), 'kept');
  ws.ensure('cto');
  expect(fs.readFileSync(ws.notesPath('cto'), 'utf8')).toBe('kept');
});

test('ceo gets founder-profile.md', () => {
  ws.ensure('ceo');
  expect(fs.readFileSync(ws.founderProfilePath(), 'utf8')).toContain('# How the founder works');
});

test('collectOutbox rejects paths outside outbox', () => {
  ws.ensureAll();
  writeOutbox('cto', 'outbox/t1/report.md');
  for (const p of ['../ceo/notes.md', 'C:\\Windows\\win.ini', 'outbox/../../ceo/notes.md', 'outbox/missing.md', 'outbox', 'notes.md']) {
    expectBadPath(() => ws.collectOutbox('cto', [p]));
  }
});

test('collectOutbox accepts outbox/t1/report.md', () => {
  ws.ensure('cto');
  const abs = writeOutbox('cto', 'outbox/t1/report.md');
  expect(ws.collectOutbox('cto', ['outbox/t1/report.md'])).toEqual([path.resolve(abs)]);
});

test('deliverInbox returns inbox/t1/report.md and copies content', () => {
  ws.ensure('cto'); ws.ensure('qa-engineer');
  const src = writeOutbox('cto', 'outbox/t0/report.md', 'hello');
  expect(ws.deliverInbox('qa-engineer', 't1', [src])).toEqual(['inbox/t1/t0/report.md']);
  expect(fs.readFileSync(path.join(ws.dirOf('qa-engineer'), 'inbox/t1/t0/report.md'), 'utf8')).toBe('hello');
});

test('storeDeliverables copies under projects/<pid>/deliverables/<tid>', () => {
  ws.ensure('cto');
  const src = writeOutbox('cto', 'outbox/t1/a.md', 'A');
  const [stored] = ws.storeDeliverables('p1', 't1', [src]);
  expect(stored).toBe(path.join(root, 'projects', 'p1', 'deliverables', 't1', 'a.md'));
  expect(fs.readFileSync(stored, 'utf8')).toBe('A');
  expect(ws.isInsideProjects(stored)).toBe(true);
  expect(ws.isInsideProjects(src)).toBe(false);
});

test('resolveOwnFile accepts inbox and outbox, rejects notes.md and ../', () => {
  ws.ensure('cto');
  writeOutbox('cto', 'outbox/t1/a.md');
  writeOutbox('cto', 'inbox/t0/b.md');
  expect(ws.resolveOwnFile('cto', 'outbox/t1/a.md')).toBe(path.join(ws.dirOf('cto'), 'outbox', 't1', 'a.md'));
  expect(ws.resolveOwnFile('cto', 'inbox/t0/b.md')).toBe(path.join(ws.dirOf('cto'), 'inbox', 't0', 'b.md'));
  expectBadPath(() => ws.resolveOwnFile('cto', 'notes.md'));
  expectBadPath(() => ws.resolveOwnFile('cto', '../ceo/notes.md'));
});

test('deliverInbox keeps same-named files from different tasks apart', () => {
  ws.ensure('cto'); ws.ensure('ceo');
  const a = writeOutbox('cto', 'outbox/tA/result.md', 'A');
  const b = writeOutbox('cto', 'outbox/tB/result.md', 'B');
  const out = ws.deliverInbox('ceo', 'plan', [a, b, a]);
  expect(out).toEqual(['inbox/plan/tA/result.md', 'inbox/plan/tB/result.md']);
  expect(fs.readFileSync(path.join(ws.dirOf('ceo'), out[1]), 'utf8')).toBe('B');
});
