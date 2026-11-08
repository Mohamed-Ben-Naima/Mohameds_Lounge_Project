import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCommand } from '../../src/gate/egress-rules.mjs';

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/gate/egress-hook.mjs');

test.each([
  'curl https://x',
  'Invoke-WebRequest x',
  'invoke-webrequest -Uri foo',
  'git push origin main',
  'echo https://evil.example',
  'nmap 10.0.0.1',
  'wget foo',
  'gh pr create',
  'npm publish',
  'cd x && ssh host',
])('denies %s', cmd => {
  const r = checkCommand(cmd);
  expect(r.allow).toBe(false);
});

test.each(['npm test', 'git commit -m "x"', 'ls -la', 'npm install zod', 'node build.js', 'git status'])('allows %s', cmd => {
  expect(checkCommand(cmd)).toEqual({ allow: true });
});

function runHook(input: string) {
  return spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });
}

test('hook denies curl via stdin', () => {
  const r = runHook(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'curl x' } }));
  expect(r.status).toBe(0);
  const out = JSON.parse(r.stdout);
  expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
  expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse');
});

test('hook is silent for ls', () => {
  const r = runHook(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }));
  expect(r.status).toBe(0);
  expect(r.stdout).toBe('');
});

test('hook denies malformed input', () => {
  const r = runHook('not json');
  expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
});

const CWD = 'C:\\hq\\data\\workspaces\\software-engineer';
test.each([
  'cat C:/Users/ASUS/.claude/.credentials.json',
  'type C:\\hq\\data\\hq.sqlite',
  'cat ../ceo/notes.md',
  'sqlite3 ..\\..\\hq.sqlite',
  'cat ~/secrets.txt',
  'echo $HOME',
  'dir %USERPROFILE%',
  'Get-Content $env:APPDATA\\x',
  'cat /c/Users/ASUS/file',
  'cat data/runs/r1/mcp.json',
])('denies outside-workspace access: %s', cmd => {
  expect(checkCommand(cmd, CWD).allow).toBe(false);
});

test.each(['node build.js', 'cat outbox/t1/x.md', 'ls C:/hq/data/workspaces/software-engineer/outbox', 'npm test -- --run'])('allows in-workspace: %s', cmd => {
  expect(checkCommand(cmd, CWD)).toEqual({ allow: true });
});

test('hook passes cwd to the rules', () => {
  const r = runHook(JSON.stringify({ tool_name: 'Bash', cwd: CWD, tool_input: { command: 'cat ../ceo/notes.md' } }));
  expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
});
