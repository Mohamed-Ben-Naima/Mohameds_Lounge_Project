// Command line, MCP config and settings for one agent run of `claude -p`.
import { builtinToolsFor, mcpToolsFor } from './toolProfiles.ts';
import type { RunSpec } from './types.ts';

export interface RunFiles {
  systemPromptPath: string;
  mcpConfigPath: string;
  settingsPath: string;
}

export function buildClaudeArgs(spec: RunSpec, files: RunFiles): string[] {
  const builtins = builtinToolsFor(spec.agent);
  const allowed = [...builtins, ...mcpToolsFor(spec.agent).map(t => `mcp__hq__${t}`)];
  const session = spec.session
    ? spec.session.resume ? ['--resume', spec.session.id] : ['--session-id', spec.session.id]
    : ['--no-session-persistence'];
  return [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--restricted',
    '--strict-mcp-config',
    '--mcp-config', files.mcpConfigPath,
    '--settings', files.settingsPath,
    '--tools', builtins.join(','),
    '--allowedTools', allowed.join(','),
    '--permission-mode', 'dontAsk',
    '--permission-prompts', 'none',
    '--disable-slash-commands',
    '--append-system-prompt-file', files.systemPromptPath,
    '--model', spec.model,
    ...session,
  ];
}

// Absolute URL of the tsx loader: the MCP server starts in the agent's workspace, where a bare
// `--import tsx` cannot be resolved.
const TSX_LOADER = import.meta.resolve('tsx');

export function buildMcpConfig(hqUrl: string, token: string, mcpEntryAbs: string): object {
  return {
    mcpServers: {
      hq: { command: process.execPath, args: ['--import', TSX_LOADER, mcpEntryAbs], env: { HQ_URL: hqUrl, HQ_RUN_TOKEN: token } },
    },
  };
}

export function buildSettings(hookScriptAbs: string): object {
  return {
    hooks: {
      PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: `"${process.execPath}" "${hookScriptAbs}"` }] }],
    },
  };
}
