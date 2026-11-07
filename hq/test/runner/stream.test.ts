import { expect, test } from 'vitest';
import { detectUsageLimit, parseStreamLine } from '../../src/runner/stream.ts';

test('parses init', () => {
  const line = '{"type":"system","subtype":"init","session_id":"s1","tools":["Read","mcp__hq__submit_result"],"mcp_servers":[{"name":"hq","status":"connected"}],"model":"claude-sonnet-5-5"}';
  expect(parseStreamLine(line)).toEqual([{ kind: 'init', sessionId: 's1', tools: ['Read', 'mcp__hq__submit_result'], mcpServers: [{ name: 'hq', status: 'connected' }], model: 'claude-sonnet-5-5' }]);
});

test('parses tool_use and text', () => {
  const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Working' }, { type: 'tool_use', name: 'Write', input: {} }] } });
  expect(parseStreamLine(line)).toEqual([{ kind: 'text', text: 'Working' }, { kind: 'tool_use', tool: 'Write' }]);
});

test('parses result cost', () => {
  const line = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.0123, result: 'Done', session_id: 's1' });
  expect(parseStreamLine(line)).toEqual([{ kind: 'result', isError: false, costUsd: 0.0123, text: 'Done', sessionId: 's1' }]);
});

test('ignores junk and unknown types', () => {
  expect(parseStreamLine('not json')).toEqual([]);
  expect(parseStreamLine('{"type":"user"}')).toEqual([]);
  expect(parseStreamLine('')).toEqual([]);
});

test('usage limit with epoch', () => {
  const r = detectUsageLimit({ isError: true, text: 'Claude AI usage limit reached|1794100000' });
  expect(r?.resetAt?.getTime()).toBe(1794100000000);
});

test('usage limit without epoch', () => {
  expect(detectUsageLimit({ isError: true, text: '5-hour limit reached ∙ resets 7pm' })).toEqual({ resetAt: null });
});

test('normal error is not usage limit', () => {
  expect(detectUsageLimit({ isError: true, text: 'Tool failed' })).toBeNull();
  expect(detectUsageLimit({ isError: false, text: 'I hit no usage limit today' })).toBeNull();
});
