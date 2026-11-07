import { expect, test } from 'vitest';
import { buildClaudeArgs, buildMcpConfig, buildSettings } from '../../src/runner/args.ts';
import { getAgent } from '../../src/org/roster.ts';
import type { RunSpec } from '../../src/runner/types.ts';

const files = { systemPromptPath: 'C:/r/system.md', mcpConfigPath: 'C:/r/mcp.json', settingsPath: 'C:/r/settings.json' };
const spec = (agentId: string, extra: Partial<RunSpec> = {}): RunSpec => ({
  runId: 'run_1', agent: getAgent(agentId), purpose: 'work', prompt: 'SECRET PROMPT TEXT', cwd: 'C:/w', model: 'sonnet',
  token: 'tok', session: null, ...extra,
});
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

test('every run is restricted and strict', () => {
  const a = buildClaudeArgs(spec('trend-scout'), files);
  for (const f of ['-p', '--restricted', '--strict-mcp-config', '--verbose', '--disable-slash-commands']) expect(a).toContain(f);
  expect(after(a, '--output-format')).toBe('stream-json');
  expect(after(a, '--permission-mode')).toBe('dontAsk');
  expect(after(a, '--permission-prompts')).toBe('none');
  expect(after(a, '--mcp-config')).toBe(files.mcpConfigPath);
  expect(after(a, '--settings')).toBe(files.settingsPath);
  expect(after(a, '--append-system-prompt-file')).toBe(files.systemPromptPath);
  expect(after(a, '--model')).toBe('sonnet');
});

test('pentester has no Bash', () => {
  expect(after(buildClaudeArgs(spec('pentester'), files), '--tools').split(',')).not.toContain('Bash');
});

test('software-engineer has Bash', () => {
  expect(after(buildClaudeArgs(spec('software-engineer'), files), '--tools').split(',')).toContain('Bash');
});

test('cto may create subtasks, pentester may not', () => {
  expect(after(buildClaudeArgs(spec('cto'), files), '--allowedTools').split(',')).toContain('mcp__hq__create_subtask');
  expect(after(buildClaudeArgs(spec('pentester'), files), '--allowedTools').split(',')).not.toContain('mcp__hq__create_subtask');
});

test('cfo gets set_budget, cto does not', () => {
  expect(after(buildClaudeArgs(spec('cfo'), files), '--allowedTools')).toContain('mcp__hq__set_budget');
  expect(after(buildClaudeArgs(spec('cto'), files), '--allowedTools')).not.toContain('mcp__hq__set_budget');
});

test('first chat run uses --session-id, later --resume', () => {
  const first = buildClaudeArgs(spec('ceo', { purpose: 'chat', session: { id: 'uuid-1', resume: false } }), files);
  expect(after(first, '--session-id')).toBe('uuid-1');
  expect(first).not.toContain('--resume');
  const later = buildClaudeArgs(spec('ceo', { purpose: 'chat', session: { id: 'uuid-1', resume: true } }), files);
  expect(after(later, '--resume')).toBe('uuid-1');
});

test('work run has --no-session-persistence', () => {
  expect(buildClaudeArgs(spec('cto'), files)).toContain('--no-session-persistence');
});

test('prompt is not in args', () => {
  expect(buildClaudeArgs(spec('cto'), files).join(' ')).not.toContain('SECRET PROMPT TEXT');
});

test('mcp config and settings shapes', () => {
  const m = buildMcpConfig('http://127.0.0.1:4600', 'tok', 'C:/hq/src/mcp/server.ts') as any;
  expect(m.mcpServers.hq).toMatchObject({ command: process.execPath, args: ['--import', 'tsx', 'C:/hq/src/mcp/server.ts'], env: { HQ_URL: 'http://127.0.0.1:4600', HQ_RUN_TOKEN: 'tok' } });
  const s = buildSettings('C:/hq/src/gate/egress-hook.mjs') as any;
  expect(s.hooks.PreToolUse[0].matcher).toBe('Bash|PowerShell');
  expect(s.hooks.PreToolUse[0].hooks[0].command).toContain('egress-hook.mjs');
});
