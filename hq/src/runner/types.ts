import type { AgentDef, RunPurpose } from '../types.ts';

export interface RunSpec {
  runId: string;
  agent: AgentDef;
  purpose: RunPurpose;
  prompt: string;
  cwd: string;
  model: string;
  token: string;
  session: { id: string; resume: boolean } | null;
}

export type StreamEvent =
  | { kind: 'init'; sessionId: string; tools: string[]; mcpServers: { name: string; status: string }[]; model: string }
  | { kind: 'tool_use'; tool: string }
  | { kind: 'text'; text: string }
  | { kind: 'result'; isError: boolean; costUsd: number; text: string; sessionId: string };

export interface RunOutcome {
  ok: boolean;
  costUsd: number;
  sessionId: string | null;
  finalText: string;
  usageLimit: { resetAt: Date | null } | null;
  error: string | null;
}

export interface AgentRunner {
  run(spec: RunSpec, onEvent: (e: StreamEvent) => void): Promise<RunOutcome>;
}
