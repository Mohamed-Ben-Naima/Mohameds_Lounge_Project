// Claude Code PreToolUse hook: blocks shell commands that would send data out or leave the
// agent's workspace. Fails closed: any error, including a failed import, denies the command.

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }));
}

process.on('uncaughtException', () => {
  deny('HQ gate failed while checking this command, so it is blocked.');
  process.exit(0);
});

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', async () => {
  try {
    const input = JSON.parse(raw);
    if (input?.tool_name !== 'Bash' && input?.tool_name !== 'PowerShell') return;
    const { checkCommand } = await import('./egress-rules.mjs');
    const result = checkCommand(input?.tool_input?.command, input?.cwd);
    if (!result.allow) deny(result.reason);
  } catch {
    deny('HQ gate could not read this tool call, so it is blocked.');
  }
});
