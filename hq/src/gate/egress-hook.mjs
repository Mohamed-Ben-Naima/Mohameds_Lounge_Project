// Claude Code PreToolUse hook: blocks shell commands that would send data out. Fails closed.
import { checkCommand } from './egress-rules.mjs';

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }));
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    deny('HQ gate could not read this tool call, so it is blocked.');
    return;
  }
  if (input?.tool_name === 'Bash' || input?.tool_name === 'PowerShell') {
    const result = checkCommand(input?.tool_input?.command);
    if (!result.allow) deny(result.reason);
  }
});
