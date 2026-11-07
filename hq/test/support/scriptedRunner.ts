// Test double for AgentRunner: instead of launching Claude, runs a script that calls
// Company methods with the run's caller context, exactly like the MCP tools would.
import type { Company, CallerCtx } from '../../src/domain/company.ts';
import type { TokenRegistry } from '../../src/orchestrator/tokens.ts';
import type { AgentRunner, RunOutcome, RunSpec } from '../../src/runner/types.ts';

export type Script = (c: CallerCtx, co: Company, spec: RunSpec, call: number) => void | Partial<RunOutcome>;

export class ScriptedRunner implements AgentRunner {
  readonly calls: { agentId: string; purpose: string; prompt: string }[] = [];
  private readonly counts = new Map<string, number>();
  private readonly company: Company;
  private readonly tokens: TokenRegistry;
  private readonly scripts: Record<string, Script>;

  constructor(company: Company, tokens: TokenRegistry, scripts: Record<string, Script>) {
    this.company = company;
    this.tokens = tokens;
    this.scripts = scripts;
  }

  async run(spec: RunSpec): Promise<RunOutcome> {
    const key = `${spec.agent.id}:${spec.purpose}`;
    const call = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, call);
    this.calls.push({ agentId: spec.agent.id, purpose: spec.purpose, prompt: spec.prompt });
    const ctx = this.tokens.resolve(spec.token);
    if (!ctx) throw new Error('scripted runner got an unknown token');
    const base: RunOutcome = { ok: true, costUsd: 0.01, sessionId: null, finalText: 'ok', usageLimit: null, error: null };
    const script = this.scripts[key];
    const override = script ? script(ctx, this.company, spec, call) : undefined;
    return { ...base, ...(override ?? {}) };
  }
}

/** The task id a review prompt asks about. */
export function reviewedId(spec: RunSpec): string {
  const m = spec.prompt.match(/taskId "([^"]+)"/);
  if (!m) throw new Error('no taskId in review prompt');
  return m[1];
}
