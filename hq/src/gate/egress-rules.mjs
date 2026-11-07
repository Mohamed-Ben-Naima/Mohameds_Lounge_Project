// Shell-command egress rules for agent runs. Plain JS so the hook runs with bare `node`.
// This is a denylist and therefore a second line of defence: the first is that agents
// hold no credentials for any outside service.

const URL_RE = /\bhttps?:\/\//i;

const BLOCKED_WORDS = [
  'curl', 'wget', 'Invoke-WebRequest', 'iwr', 'Invoke-RestMethod', 'irm', 'Start-BitsTransfer',
  'ssh', 'scp', 'sftp', 'ftp', 'telnet', 'nc', 'ncat', 'netcat',
  'nmap', 'masscan', 'sqlmap', 'hydra', 'nikto',
  'Send-MailMessage', 'sendmail',
];

const BLOCKED_PHRASES = [
  'git push', 'git remote add', 'npm publish', 'pnpm publish', 'yarn publish', 'docker push', 'terraform apply',
];

const BLOCKED_COMMANDS = ['gh', 'aws', 'az', 'gcloud', 'kubectl'];

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD_RE = new RegExp(`(^|[^\\w-])(${BLOCKED_WORDS.map(escape).join('|')})(?![\\w-])`, 'i');
const PHRASE_RE = new RegExp(`(${BLOCKED_PHRASES.map(p => p.split(' ').map(escape).join('\\s+')).join('|')})\\b`, 'i');
// A command word at the start of the line or after a shell separator.
const COMMAND_RE = new RegExp(`(^|[;&|]\\s*|\\(\\s*)(${BLOCKED_COMMANDS.join('|')})\\s`, 'i');

/**
 * @param {string} command
 * @returns {{allow: true} | {allow: false, reason: string}}
 */
export function checkCommand(command) {
  const cmd = String(command ?? '');
  if (URL_RE.test(cmd)) {
    return { allow: false, reason: 'Use WebFetch to read web pages; nothing leaves this machine from a shell.' };
  }
  const word = cmd.match(WORD_RE)?.[2] ?? cmd.match(PHRASE_RE)?.[1] ?? cmd.match(COMMAND_RE)?.[2];
  if (word) {
    return { allow: false, reason: `"${word}" is blocked: network, publishing and scanning tools are not allowed. Anything that must leave the machine goes through request_outbound.` };
  }
  return { allow: true };
}
