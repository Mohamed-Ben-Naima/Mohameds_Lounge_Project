// The run queue: which agent runs may start now. Two lanes (CEO chat, everything else),
// priority order, and a company-wide pause when the Claude usage limit is hit.
import type { Db } from '../db/db.ts';
import * as runs from '../db/repos/runs.ts';
import * as tasks from '../db/repos/tasks.ts';
import * as kv from '../db/repos/kv.ts';
import type { EventBus } from '../events/bus.ts';
import type { Run, RunPurpose } from '../types.ts';

export interface RunRequest {
  agentId: string;
  purpose: RunPurpose;
  taskId?: string;
  projectId?: string;
  payload?: Record<string, unknown>;
}

const PRIORITY: Record<RunPurpose, number> = {
  chat: 0, review: 1, recommend: 1, triage: 1, compile: 2, plan_delivery: 2, work: 3,
};

const PAUSE_KEY = 'paused_until';

export class RunQueue {
  private readonly db: Db;
  private readonly bus: EventBus;
  private readonly maxWork: number;
  private readonly now: () => Date;

  constructor(db: Db, bus: EventBus, opts: { maxWork: number; now: () => Date }) {
    this.db = db;
    this.bus = bus;
    this.maxWork = opts.maxWork;
    this.now = opts.now;
  }

  enqueue(r: RunRequest): Run {
    const run = runs.create(this.db, {
      agentId: r.agentId, purpose: r.purpose, taskId: r.taskId ?? null, projectId: r.projectId ?? null, payload: r.payload ?? {},
    });
    this.bus.emit({ type: 'run.updated', run });
    return run;
  }

  nextStartable(): Run[] {
    if (this.isPaused()) return [];
    const running = runs.listByStatus(this.db, 'running');
    let chatFree = 1 - running.filter(r => r.purpose === 'chat').length;
    let workFree = this.maxWork - running.filter(r => r.purpose !== 'chat').length;
    const queued = runs.listByStatus(this.db, 'queued')
      .map((r, i) => ({ r, i }))
      .sort((a, b) => PRIORITY[a.r.purpose] - PRIORITY[b.r.purpose] || a.i - b.i)
      .map(x => x.r);
    // One non-chat run per agent: an agent works on one thing at a time at its own desk.
    const busy = new Set(running.filter(r => r.purpose !== 'chat').map(r => r.agentId));
    const out: Run[] = [];
    for (const r of queued) {
      if (r.purpose === 'chat' && chatFree > 0) { out.push(r); chatFree--; }
      else if (r.purpose !== 'chat' && workFree > 0 && !busy.has(r.agentId)) { out.push(r); workFree--; busy.add(r.agentId); }
    }
    return out;
  }

  pausedUntil(): Date | null {
    const v = kv.get(this.db, PAUSE_KEY);
    return v ? new Date(v) : null;
  }

  isPaused(): boolean {
    const until = this.pausedUntil();
    return until !== null && this.now() < until;
  }

  pause(until: Date): void {
    kv.set(this.db, PAUSE_KEY, until.toISOString());
    this.bus.emit({ type: 'company.paused', until: until.toISOString() });
  }

  resume(): void {
    if (kv.get(this.db, PAUSE_KEY) === null) return;
    kv.set(this.db, PAUSE_KEY, null);
    this.bus.emit({ type: 'company.paused', until: null });
  }

  /** After a restart nothing is really running: put interrupted work back in the queue. */
  recoverOrphans(): void {
    for (const r of runs.listByStatus(this.db, 'running')) runs.update(this.db, r.id, { status: 'queued', startedAt: null });
    for (const t of tasks.listByStatus(this.db, 'running')) tasks.update(this.db, t.id, { status: 'queued' });
  }
}
