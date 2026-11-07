// The environment an agent's claude process gets: just enough to run, no secrets.
// ANTHROPIC_API_KEY is dropped too, so runs always use the founder's subscription login.
const ALLOWED = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH',
  'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'LANG',
]);

export function buildChildEnv(parent: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(parent)) {
    if (v !== undefined && ALLOWED.has(k.toUpperCase())) env[k] = v;
  }
  return env;
}
