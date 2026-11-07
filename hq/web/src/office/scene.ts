// The live pixel office. Agents sit at their desks; they move only when react() says a real event happened.
import { BOARD_COLUMNS } from '../../../src/domain/lifecycle.ts';
import type { CompanyEvent } from '../../../src/events/bus.ts';
import type { DeptId } from '../../../src/types.ts';
import { reviewerOf } from '../../../src/org/hierarchy.ts';
import { groupByColumn, inboxCount, type AgentView, type UiState } from '../store.ts';
import { GRID, ROOMS, TILE, deskOf, isWalkable, pathBetween, spotIn, type Point } from './layout.ts';
import { react, type Move } from './choreography.ts';
import { makeSprites } from './sprites.ts';

const SPEED = 8; // tiles per second
const PAUSE_AT_TARGET_MS = 900;

interface Actor {
  view: AgentView;
  home: Point;
  pos: { x: number; y: number };
  path: Point[];
  queue: Move[];
  returnAt: number | null;
  anim: 'idle' | 'typing';
  bubble: '?' | 'zzz' | null;
}

export interface OfficeScene { update(s: UiState, e: CompanyEvent | null): void }

export function createScene(canvas: HTMLCanvasElement, onAgentClick: (agentId: string) => void): OfficeScene {
  canvas.width = GRID.w * TILE;
  canvas.height = GRID.h * TILE;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const label = document.createElement('div');
  label.className = 'office-label';
  label.hidden = true;
  document.body.append(label);

  const actors = new Map<string, Actor>();
  let state: UiState | null = null;
  const colorOf = (dept: DeptId | null) => state?.departments.find(d => d.id === dept)?.color ?? '#888888';

  function ensureActors(s: UiState) {
    for (const a of s.agents) {
      const existing = actors.get(a.id);
      if (existing) { existing.view = a; continue; }
      const home = deskOf(a.id, id => s.agents.find(x => x.id === id)?.dept ?? null);
      actors.set(a.id, {
        view: a, home, pos: { ...home }, path: [], queue: [], returnAt: null,
        anim: a.state === 'working' ? 'typing' : 'idle',
        bubble: s.pausedUntil && new Date(s.pausedUntil) > new Date() ? 'zzz' : a.state === 'blocked' ? '?' : null,
      });
    }
  }

  function targetOf(actor: Actor, m: Move): Point {
    if (m.to === 'desk') return actor.home;
    if (m.to === 'founder') return spotIn('founder');
    if (m.to === 'board') {
      const base = spotIn('board');
      const offset = (hash(actor.view.id) % 5) - 2;
      const p = { x: base.x + offset, y: base.y + 1 };
      return isWalkable(p) ? p : base;
    }
    const other = actors.get(m.to.desk);
    if (!other) return actor.home;
    const front = { x: other.home.x, y: other.home.y + 1 };
    const side = { x: other.home.x + 1, y: other.home.y };
    return isWalkable(front) && !isDeskTile(front) ? front : isWalkable(side) ? side : other.home;
  }

  function isDeskTile(p: Point) {
    for (const a of actors.values()) if (a.home.x === p.x && a.home.y === p.y) return true;
    return false;
  }

  function startNext(actor: Actor) {
    const m = actor.queue.shift();
    if (!m) return;
    const from = { x: Math.round(actor.pos.x), y: Math.round(actor.pos.y) };
    actor.path = pathBetween(from, targetOf(actor, m)).slice(1);
    actor.returnAt = m.thenReturn ? -1 : null;
  }

  function apply(e: CompanyEvent) {
    const { moves, moods } = react(e, { reviewerOf: id => { try { return reviewerOf(id); } catch { return null; } }, agentIds: [...actors.keys()] });
    for (const m of moods) {
      const a = actors.get(m.agentId);
      if (!a) continue;
      if (m.anim) a.anim = m.anim;
      if (m.bubble !== undefined) a.bubble = m.bubble;
    }
    for (const m of moves) {
      const a = actors.get(m.agentId);
      if (!a || a.queue.length >= 3) continue;
      a.queue.push(m);
      if (a.path.length === 0 && a.returnAt === null) startNext(a);
    }
  }

  function step(dt: number, now: number) {
    for (const a of actors.values()) {
      if (a.path.length) {
        const next = a.path[0];
        const dx = next.x - a.pos.x, dy = next.y - a.pos.y;
        const dist = Math.hypot(dx, dy);
        const move = SPEED * dt;
        if (dist <= move) { a.pos = { ...next }; a.path.shift(); }
        else { a.pos.x += (dx / dist) * move; a.pos.y += (dy / dist) * move; }
        if (!a.path.length && a.returnAt === -1) a.returnAt = now + PAUSE_AT_TARGET_MS;
      } else if (a.returnAt !== null && a.returnAt > 0 && now >= a.returnAt) {
        a.returnAt = null;
        a.path = pathBetween({ x: Math.round(a.pos.x), y: Math.round(a.pos.y) }, a.home).slice(1);
      } else if (a.returnAt === null && a.queue.length) {
        startNext(a);
      }
    }
  }

  function draw(now: number) {
    const s = state;
    g.fillStyle = '#2a2d3d';
    g.fillRect(0, 0, canvas.width, canvas.height);
    // corridor floor pattern
    g.fillStyle = '#2f3244';
    for (let y = 0; y < GRID.h; y++) for (let x = (y % 2); x < GRID.w; x += 2) g.fillRect(x * TILE, y * TILE, TILE, TILE);

    for (const r of ROOMS) {
      const { x, y, w, h } = r.rect;
      const dept = s?.departments.find(d => d.id === r.id);
      g.fillStyle = dept ? mix(dept.color, '#1b1e2b', 0.28) : r.id === 'ceo' ? '#2a2f4a' : r.id === 'founder' ? '#3a3220' : r.id === 'board' ? '#1d1f2a' : '#2d2a33';
      g.fillRect(x * TILE, y * TILE, w * TILE, h * TILE);
      g.fillStyle = '#0c0e15';
      g.fillRect(x * TILE, y * TILE, w * TILE, 4);
      g.fillRect(x * TILE, (y + h) * TILE - 4, w * TILE, 4);
      g.fillRect(x * TILE, y * TILE, 4, h * TILE);
      g.fillRect((x + w) * TILE - 4, y * TILE, 4, h * TILE);
      // door
      g.fillStyle = '#2a2d3d';
      g.fillRect(r.door.x * TILE + 2, r.door.y * TILE, TILE - 4, TILE);
      // label
      g.fillStyle = dept ? dept.color : '#c9cbe0';
      g.font = 'bold 8px monospace';
      g.textBaseline = 'top';
      g.fillText(r.label, x * TILE + 6, y * TILE + (r.door.y === y ? h * TILE - 14 : 6));
    }

    drawFurniture(s, now);

    const sorted = [...actors.values()].sort((a, b) => a.pos.y - b.pos.y);
    for (const a of sorted) {
      const sp = makeSprites(colorOf(a.view.dept), a.view.role);
      const walking = a.path.length > 0;
      const atDesk = !walking && Math.round(a.pos.x) === a.home.x && Math.round(a.pos.y) === a.home.y;
      const f = Math.floor(now / 160) % 2;
      const img = walking ? sp.walk[f] : a.anim === 'typing' && atDesk ? sp.type[f] : sp.idle;
      const px = a.pos.x * TILE, py = a.pos.y * TILE - 6;
      g.drawImage(img, Math.round(px), Math.round(py));
      if (a.bubble) drawBubble(px + 8, py - 4, a.bubble, now);
    }
    // desks in front of each seat (drawn after people, so seated agents sit behind them)
    for (const a of actors.values()) {
      const { x, y } = a.home;
      g.fillStyle = '#5b3f28';
      g.fillRect(x * TILE - 3, y * TILE + 6, TILE + 6, 5);
      g.fillStyle = '#3e2a1b';
      g.fillRect(x * TILE - 3, y * TILE + 11, TILE + 6, 2);
      const working = a.anim === 'typing';
      g.fillStyle = working ? (Math.floor(now / 300) % 2 ? '#8fe3ff' : '#6fc6e8') : '#3d4a5a';
      g.fillRect(x * TILE + 3, y * TILE + 4, 10, 3);
    }
  }

  function drawFurniture(s: UiState | null, now: number) {
    // board wall with live column counts
    const board = ROOMS.find(r => r.id === 'board')!;
    const bx = (board.rect.x + 1) * TILE, by = (board.rect.y + 1) * TILE, bw = (board.rect.w - 2) * TILE;
    g.fillStyle = '#0a0b10';
    g.fillRect(bx, by, bw, 3 * TILE);
    if (s) {
      const groups = groupByColumn(s.projects);
      const colW = bw / BOARD_COLUMNS.length;
      BOARD_COLUMNS.forEach((c, i) => {
        const n = groups[c.id].length;
        const founder = c.id === 'awaiting_approval' || c.id === 'awaiting_founder';
        g.fillStyle = founder ? '#ffd84d' : '#4f6b9a';
        for (let k = 0; k < Math.min(n, 5); k++) g.fillRect(bx + i * colW + 2, by + 3 * TILE - 6 - k * 8, colW - 4, 6);
        g.fillStyle = '#2b3048';
        g.fillRect(bx + i * colW + colW - 1, by + 2, 1, 3 * TILE - 4);
      });
    }
    // meeting table
    const meeting = ROOMS.find(r => r.id === 'meeting')!;
    g.fillStyle = '#4a3526';
    g.fillRect((meeting.rect.x + 2) * TILE, (meeting.rect.y + 3) * TILE, (meeting.rect.w - 4) * TILE, 2 * TILE);
    // founder approval desk with the inbox count
    const founder = ROOMS.find(r => r.id === 'founder')!;
    const fx = (founder.rect.x + 2) * TILE, fy = (founder.rect.y + 2) * TILE;
    g.fillStyle = '#6b4a2f';
    g.fillRect(fx, fy, 5 * TILE, TILE + 4);
    const pending = s ? inboxCount(s) : 0;
    g.fillStyle = pending ? '#ffd84d' : '#57607a';
    g.font = 'bold 9px monospace';
    g.fillText(pending ? `INBOX ${pending}` : 'INBOX 0', fx + 6, fy + 5);
  }

  function drawBubble(x: number, y: number, kind: '?' | 'zzz', now: number) {
    if (kind === '?') {
      g.fillStyle = '#e35d5d';
      g.beginPath(); g.arc(x, y - 4, 5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.font = 'bold 8px monospace'; g.fillText('?', x - 2, y - 8);
    } else {
      g.fillStyle = '#c9cbe0'; g.font = 'bold 7px monospace';
      g.fillText('z'.repeat(1 + (Math.floor(now / 500) % 3)), x - 2, y - 10);
    }
  }

  function agentAt(evt: MouseEvent): Actor | null {
    const rect = canvas.getBoundingClientRect();
    const tx = ((evt.clientX - rect.left) / rect.width) * GRID.w;
    const ty = ((evt.clientY - rect.top) / rect.height) * GRID.h;
    let best: Actor | null = null, bestD = 0.9;
    for (const a of actors.values()) {
      const d = Math.hypot(a.pos.x + 0.5 - tx, a.pos.y + 0.2 - ty);
      if (d < bestD) { best = a; bestD = d; }
    }
    return best;
  }

  canvas.addEventListener('mousemove', evt => {
    const a = agentAt(evt);
    canvas.style.cursor = a ? 'pointer' : 'default';
    label.hidden = !a;
    if (a) {
      const what = a.view.state === 'working' ? 'working' : a.view.state === 'waiting' ? 'waiting for review/subtasks' : a.view.state === 'blocked' ? 'blocked' : 'idle';
      label.textContent = `${a.view.title} · ${what}`;
      label.style.left = `${evt.clientX + 12}px`;
      label.style.top = `${evt.clientY + 12}px`;
    }
  });
  canvas.addEventListener('mouseleave', () => { label.hidden = true; });
  canvas.addEventListener('click', evt => { const a = agentAt(evt); if (a) onAgentClick(a.view.id); });

  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    step(dt, now);
    draw(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return {
    update(s, e) {
      state = s;
      ensureActors(s);
      if (e) apply(e);
    },
  };
}

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

function mix(a: string, b: string, t: number): string {
  const pa = Number.parseInt(a.slice(1), 16), pb = Number.parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * t + ((pb >> shift) & 255) * (1 - t));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
