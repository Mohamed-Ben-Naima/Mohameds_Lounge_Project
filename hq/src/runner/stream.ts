// Parses `claude -p --output-format stream-json` lines.
import type { StreamEvent } from './types.ts';

export function parseStreamLine(line: string): StreamEvent[] {
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return [];
  }
  if (msg?.type === 'system' && msg.subtype === 'init') {
    return [{
      kind: 'init', sessionId: String(msg.session_id ?? ''), tools: msg.tools ?? [],
      mcpServers: (msg.mcp_servers ?? []).map((s: any) => ({ name: s.name, status: s.status })), model: String(msg.model ?? ''),
    }];
  }
  if (msg?.type === 'assistant') {
    const out: StreamEvent[] = [];
    for (const block of msg.message?.content ?? []) {
      if (block?.type === 'text' && block.text) out.push({ kind: 'text', text: block.text });
      if (block?.type === 'tool_use') out.push({ kind: 'tool_use', tool: String(block.name) });
    }
    return out;
  }
  if (msg?.type === 'result') {
    return [{
      kind: 'result', isError: Boolean(msg.is_error), costUsd: Number(msg.total_cost_usd ?? 0),
      text: String(msg.result ?? ''), sessionId: String(msg.session_id ?? ''),
    }];
  }
  return [];
}

// Only an error result can be a usage limit: agents may legitimately write about limits
// (e.g. while researching Claude plans) in a normal final answer.
const LIMIT = /usage limit|limit reached/i;

export function detectUsageLimit(r: { isError: boolean; text: string }): { resetAt: Date | null } | null {
  if (!r.isError || !LIMIT.test(r.text)) return null;
  const epoch = r.text.match(/\|(\d{10})\s*$/);
  return { resetAt: epoch ? new Date(Number(epoch[1]) * 1000) : null };
}
