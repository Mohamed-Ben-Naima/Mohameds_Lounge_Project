// Runs one agent as a headless, restricted Claude Code process.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { buildChildEnv } from '../gate/childEnv.ts';
import { buildClaudeArgs, buildMcpConfig, buildSettings, type RunFiles } from './args.ts';
import { jobDescription } from './prompts.ts';
import { detectUsageLimit, parseStreamLine } from './stream.ts';
import type { AgentRunner, RunOutcome, RunSpec, StreamEvent } from './types.ts';

export interface ClaudeRunnerOpts {
  claudePath: string;
  hqUrl: () => string;
  mcpEntry: string;
  hookScript: string;
  runsDir: string;
  timeoutMs: number;
  companyName: string;
}

export class ClaudeRunner implements AgentRunner {
  private readonly o: ClaudeRunnerOpts;

  constructor(opts: ClaudeRunnerOpts) {
    this.o = opts;
  }

  writeRunFiles(spec: RunSpec): RunFiles {
    const dir = path.join(this.o.runsDir, spec.runId);
    fs.mkdirSync(dir, { recursive: true });
    const files: RunFiles = {
      systemPromptPath: path.join(dir, 'system.md'),
      mcpConfigPath: path.join(dir, 'mcp.json'),
      settingsPath: path.join(dir, 'settings.json'),
    };
    fs.writeFileSync(files.systemPromptPath, jobDescription(spec.agent, this.o.companyName));
    fs.writeFileSync(files.mcpConfigPath, JSON.stringify(buildMcpConfig(this.o.hqUrl(), spec.token, this.o.mcpEntry), null, 2));
    fs.writeFileSync(files.settingsPath, JSON.stringify(buildSettings(this.o.hookScript), null, 2));
    return files;
  }

  run(spec: RunSpec, onEvent: (e: StreamEvent) => void): Promise<RunOutcome> {
    const files = this.writeRunFiles(spec);
    const log = fs.createWriteStream(path.join(this.o.runsDir, spec.runId, 'stream.jsonl'));
    return new Promise(resolve => {
      const child = spawn(this.o.claudePath, buildClaudeArgs(spec, files), {
        cwd: spec.cwd, env: buildChildEnv(process.env), shell: false, windowsHide: true,
      });
      let result: Extract<StreamEvent, { kind: 'result' }> | null = null;
      let sessionId: string | null = null;
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, this.o.timeoutMs);

      readline.createInterface({ input: child.stdout }).on('line', line => {
        log.write(`${line}\n`);
        for (const e of parseStreamLine(line)) {
          if (e.kind === 'init') sessionId = e.sessionId;
          if (e.kind === 'result') result = e;
          onEvent(e);
        }
      });
      child.stderr.on('data', (b: Buffer) => { stderr = (stderr + b.toString()).slice(-4000); });
      child.on('error', err => { stderr += `\n${err.message}`; });
      child.on('close', code => {
        clearTimeout(timer);
        log.end();
        const r = result as Extract<StreamEvent, { kind: 'result' }> | null;
        const text = r?.text ?? '';
        const usageLimit = detectUsageLimit({ isError: r?.isError ?? true, text: text || stderr });
        const ok = !timedOut && r !== null && !r.isError && !usageLimit;
        resolve({
          ok,
          costUsd: r?.costUsd ?? 0,
          sessionId: r?.sessionId || sessionId,
          finalText: text,
          usageLimit,
          error: ok ? null : timedOut ? 'timeout' : (r?.isError ? text : stderr.trim() || `claude exited with code ${code}`).slice(0, 500),
        });
      });
      child.stdin.end(spec.prompt);
    });
  }
}
