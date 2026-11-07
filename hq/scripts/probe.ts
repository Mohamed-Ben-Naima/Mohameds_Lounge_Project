// Real-Claude probe: two small agent runs that prove the lockdown works on this machine.
// Usage: npm run probe   (needs a logged-in `claude`; uses a little of your plan's usage)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHq } from '../src/hq.ts';
import { loadConfig } from '../src/config.ts';
import { ClaudeRunner } from '../src/runner/process.ts';
import { builtinToolsFor } from '../src/runner/toolProfiles.ts';
import { buildChildEnv } from '../src/gate/childEnv.ts';
import { getAgent } from '../src/org/roster.ts';
import * as projects from '../src/db/repos/projects.ts';
import * as tasks from '../src/db/repos/tasks.ts';
import * as runs from '../src/db/repos/runs.ts';
import { HQ_ROOT } from '../src/config.ts';
import type { AgentRunner, RunOutcome, RunSpec, StreamEvent } from '../src/runner/types.ts';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-probe-'));
const config = { ...loadConfig(process.env), dataDir, port: 0 };
const PROBED = new Set(['trend-scout', 'software-engineer']);
const inits = new Map<string, Extract<StreamEvent, { kind: 'init' }>>();
const toolsUsed = new Map<string, string[]>();

const hq = createHq({
  config,
  runner: ({ url }) => {
    const real = new ClaudeRunner({
      claudePath: config.claudePath, hqUrl: url, timeoutMs: 10 * 60_000, companyName: config.companyName,
      mcpEntry: path.join(HQ_ROOT, 'src', 'mcp', 'server.ts'), hookScript: path.join(HQ_ROOT, 'src', 'gate', 'egress-hook.mjs'),
      runsDir: path.join(dataDir, 'runs'),
    });
    const runner: AgentRunner = {
      async run(spec: RunSpec, onEvent): Promise<RunOutcome> {
        if (spec.purpose !== 'work' || !PROBED.has(spec.agent.id)) {
          return { ok: true, costUsd: 0, sessionId: null, finalText: 'skipped by probe', usageLimit: null, error: null };
        }
        console.log(`… running ${spec.agent.title} for real (this takes a minute)`);
        return real.run(spec, e => {
          if (e.kind === 'init') inits.set(spec.agent.id, e);
          if (e.kind === 'tool_use') toolsUsed.set(spec.agent.id, [...(toolsUsed.get(spec.agent.id) ?? []), e.tool]);
          onEvent(e);
        });
      },
    };
    return runner;
  },
});
await hq.app.listen({ host: '127.0.0.1', port: 0 });

const p = projects.create(hq.db, { title: 'Probe', brief: 'probe', status: 'in_progress' });
const t1 = hq.company.hqCreatePhaseTask({
  projectId: p.id, phase: 'delivery', assigneeId: 'trend-scout', assignedById: 'ceo', attachAbs: [], title: 'Hello file',
  instructions: 'Write the file outbox/<your task id>/hello.md containing the single word hello, then call submit_result with that file. Do nothing else.',
});
await hq.orchestrator.idle();
const t2 = hq.company.hqCreatePhaseTask({
  projectId: p.id, phase: 'delivery', assigneeId: 'software-engineer', assignedById: 'ceo', attachAbs: [], title: 'Egress check',
  instructions: 'Run the shell command `curl https://example.com` exactly once. Then write outbox/<your task id>/result.md saying whether it was blocked and the message you got, and call submit_result with that file. Do not retry the command in other ways.',
});
await hq.orchestrator.idle();

const checks: [string, boolean, string][] = [];
const allowedFor = (id: string) => new Set([...builtinToolsFor(getAgent(id))]);
for (const id of PROBED) {
  const init = inits.get(id);
  const extra = init ? init.tools.filter(tool => !allowedFor(id).has(tool) && !tool.startsWith('mcp__hq__')) : ['(no init event)'];
  checks.push([`(a) ${id}: only its tools are available`, !!init && extra.length === 0, extra.length ? `unexpected: ${extra.join(', ')}` : init!.tools.join(', ')]);
  const hqServer = init?.mcpServers.find(s => s.name === 'hq');
  checks.push([`(b) ${id}: HQ connection is connected`, hqServer?.status === 'connected', JSON.stringify(init?.mcpServers ?? [])]);
  const others = init?.mcpServers.filter(s => s.name !== 'hq') ?? [];
  checks.push([`(c) ${id}: no other MCP servers or plugins`, others.length === 0, others.map(s => s.name).join(', ') || 'none']);
}
const r1 = tasks.get(hq.db, t1.id)!;
checks.push(['(d) trend-scout task reached review with hello.md', r1.status !== 'failed' && r1.resultFiles.some(f => f.endsWith('hello.md')), `${r1.status} ${r1.resultFiles.join(', ')} ${r1.failureReason ?? ''}`]);
const r2 = tasks.get(hq.db, t2.id)!;
const run2 = runs.listByProject(hq.db, p.id).find(r => r.taskId === t2.id && r.purpose === 'work');
const stream2 = run2 ? fs.readFileSync(path.join(dataDir, 'runs', run2.id, 'stream.jsonl'), 'utf8') : '';
const denied = /nothing leaves this machine|is blocked: network/.test(stream2);
checks.push(['(e) curl was blocked by the Gate and the task was submitted', denied && r2.status !== 'failed', `denied=${denied} status=${r2.status} ${r2.failureReason ?? ''}`]);
const cost = runs.sumCostByProject(hq.db, p.id);
checks.push(['(f) cost was recorded', cost > 0, `$${cost.toFixed(4)} (API-equivalent)`]);
checks.push(['(g) agents get no ANTHROPIC_API_KEY', !('ANTHROPIC_API_KEY' in buildChildEnv(process.env)), 'env allowlist']);

console.log('\nHQ probe results');
for (const [name, ok, info] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      ${info}`);
console.log(`\nRun logs: ${path.join(dataDir, 'runs')}`);
await hq.app.close();
process.exit(checks.every(c => c[1]) ? 0 : 1);
