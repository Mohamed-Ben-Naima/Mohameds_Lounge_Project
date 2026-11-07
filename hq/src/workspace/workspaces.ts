// Each agent's private desk: notes, inbox (inputs), outbox (outputs).
// Files only move between agents by being attached to a task, through HQ.
import fs from 'node:fs';
import path from 'node:path';
import { PolicyError } from '../domain/errors.ts';
import { ROSTER, getAgent } from '../org/roster.ts';

const FOUNDER_PROFILE = '# How the founder works\n\n(The CEO keeps this up to date. You can edit it.)\n';

export class Workspaces {
  readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
  }

  dirOf(agentId: string): string {
    getAgent(agentId);
    return path.join(this.rootDir, 'workspaces', agentId);
  }

  notesPath(agentId: string): string {
    return path.join(this.dirOf(agentId), 'notes.md');
  }

  founderProfilePath(): string {
    return path.join(this.dirOf('ceo'), 'founder-profile.md');
  }

  ensure(agentId: string): void {
    const dir = this.dirOf(agentId);
    fs.mkdirSync(path.join(dir, 'inbox'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'outbox'), { recursive: true });
    writeIfMissing(this.notesPath(agentId), `# Notes — ${getAgent(agentId).title}\n`);
    if (agentId === 'ceo') writeIfMissing(this.founderProfilePath(), FOUNDER_PROFILE);
  }

  ensureAll(): void {
    for (const a of ROSTER) this.ensure(a.id);
  }

  /** Copies absolute source files into the agent's inbox/<folder>/ and returns workspace-relative paths. */
  deliverInbox(agentId: string, folder: string, files: string[]): string[] {
    const target = path.join(this.dirOf(agentId), 'inbox', folder);
    fs.mkdirSync(target, { recursive: true });
    return files.map(src => {
      const name = path.basename(src);
      fs.copyFileSync(src, path.join(target, name));
      return `inbox/${folder}/${name}`;
    });
  }

  /** Validates that every path is an existing file in the agent's own outbox. */
  collectOutbox(agentId: string, relPaths: string[]): string[] {
    return relPaths.map(p => this.resolveInside(agentId, p, ['outbox']));
  }

  /** A file the agent owns: under its inbox/ or outbox/. Used for attachments. */
  resolveOwnFile(agentId: string, relPath: string): string {
    return this.resolveInside(agentId, relPath, ['inbox', 'outbox']);
  }

  storeDeliverables(projectId: string, taskId: string, absFiles: string[]): string[] {
    const target = path.join(this.rootDir, 'projects', projectId, 'deliverables', taskId);
    fs.mkdirSync(target, { recursive: true });
    return absFiles.map(src => {
      const dest = path.join(target, path.basename(src));
      fs.copyFileSync(src, dest);
      return dest;
    });
  }

  isInsideProjects(absPath: string): boolean {
    return isWithin(path.join(this.rootDir, 'projects'), path.resolve(absPath));
  }

  private resolveInside(agentId: string, relPath: string, allowedRoots: string[]): string {
    const bad = () => new PolicyError('bad_path', `"${relPath}" is not a file in your ${allowedRoots.join(' or ')} folder.`);
    if (!relPath || path.isAbsolute(relPath) || path.win32.isAbsolute(relPath)) throw bad();
    const dir = this.dirOf(agentId);
    const abs = path.resolve(dir, relPath);
    if (!allowedRoots.some(r => isWithin(path.join(dir, r), abs))) throw bad();
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw bad();
    return abs;
  }
}

function writeIfMissing(file: string, content: string) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, content);
}

/** True when child is strictly inside parent. */
function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
