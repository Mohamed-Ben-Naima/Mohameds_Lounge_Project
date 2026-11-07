// The open-floor office (approved layout A), in tiles.
//  row 1: founder office | CEO office | meeting room
//  row 2: Conception | Software & Cloud | BOARD WALL | Cybersecurity | Network & Infra
//  row 3: AI & Automation | Marketing & Content | Sales | Finance & Projects
// Corridors run between rows and down both sides.
import type { DeptId } from '../../../src/types.ts';
import { ROSTER } from '../../../src/org/roster.ts';

export const TILE = 16;
export const SCALE = 3;
export const GRID = { w: 48, h: 30 };

export type Point = { x: number; y: number };
export type RoomId = 'founder' | 'ceo' | 'meeting' | 'board' | DeptId;
export interface Room { id: RoomId; rect: { x: number; y: number; w: number; h: number }; door: Point; label: string }

function room(id: RoomId, label: string, x: number, y: number, w: number, h: number, doorSide: 'top' | 'bottom'): Room {
  const door = { x: x + Math.floor(w / 2), y: doorSide === 'top' ? y : y + h - 1 };
  return { id, label, rect: { x, y, w, h }, door };
}

export const ROOMS: Room[] = [
  room('founder', 'FOUNDER', 2, 1, 9, 8, 'bottom'),
  room('ceo', 'CEO', 12, 1, 24, 8, 'bottom'),
  room('meeting', 'MEETING', 37, 1, 9, 8, 'bottom'),
  room('conception', 'CONCEPTION', 2, 11, 9, 8, 'top'),
  room('software_cloud', 'SOFTWARE & CLOUD', 11, 11, 9, 8, 'top'),
  room('board', 'TASK BOARD', 20, 11, 8, 8, 'top'),
  room('cybersecurity', 'CYBERSECURITY', 28, 11, 9, 8, 'top'),
  room('network_infra', 'NETWORK & INFRA', 37, 11, 9, 8, 'top'),
  room('ai_automation', 'AI & AUTOMATION', 2, 21, 11, 8, 'top'),
  room('marketing_content', 'MARKETING', 13, 21, 11, 8, 'top'),
  room('sales', 'SALES', 24, 21, 11, 8, 'top'),
  room('finance_projects', 'FINANCE & PROJECTS', 35, 21, 11, 8, 'top'),
];

const ROOM_BY_ID = new Map(ROOMS.map(r => [r.id, r]));

const inside = (r: Room, p: Point) => p.x >= r.rect.x && p.x < r.rect.x + r.rect.w && p.y >= r.rect.y && p.y < r.rect.y + r.rect.h;
const isWall = (r: Room, p: Point) => inside(r, p) && (p.x === r.rect.x || p.y === r.rect.y || p.x === r.rect.x + r.rect.w - 1 || p.y === r.rect.y + r.rect.h - 1);

export function roomAt(p: Point): Room | null {
  return ROOMS.find(r => inside(r, p)) ?? null;
}

export function isWall_(p: Point): boolean {
  return ROOMS.some(r => isWall(r, p) && !(r.door.x === p.x && r.door.y === p.y));
}

export function isWalkable(p: Point): boolean {
  if (p.x < 0 || p.y < 0 || p.x >= GRID.w || p.y >= GRID.h) return false;
  return !isWall_(p);
}

export function spotIn(id: RoomId): Point {
  const r = ROOM_BY_ID.get(id)!;
  // Just inside the door, so visitors don't crowd the desks.
  return { x: r.door.x, y: r.door.y === r.rect.y ? r.door.y + 2 : r.door.y - 2 };
}

/** Lead desk at the back of the room, three specialist desks in a row in front of it. */
export function deskOf(agentId: string, deptOf: (id: string) => DeptId | null): Point {
  const dept = deptOf(agentId);
  if (dept === null) {
    const r = ROOM_BY_ID.get('ceo')!;
    return { x: r.rect.x + Math.floor(r.rect.w / 2), y: r.rect.y + 2 };
  }
  const r = ROOM_BY_ID.get(dept)!;
  const ix = r.rect.x + 1, iy = r.rect.y + 1, iw = r.rect.w - 2, ih = r.rect.h - 2;
  const team = ROSTER.filter(a => a.dept === dept);
  const me = team.find(a => a.id === agentId);
  const slot = me?.role === 'lead' ? 0 : team.filter(a => a.role === 'specialist').findIndex(a => a.id === agentId) + 1;
  if (slot === 0) return { x: ix + Math.floor(iw / 2), y: iy + ih - 1 };
  const xs = [ix + 1, ix + Math.floor(iw / 2), ix + iw - 2];
  return { x: xs[slot - 1], y: iy + Math.floor(ih / 2) };
}

/** Shortest walk on the tile grid (breadth-first search). */
export function pathBetween(a: Point, b: Point): Point[] {
  const key = (p: Point) => p.y * GRID.w + p.x;
  const prev = new Map<number, number>();
  const start = key(a), goal = key(b);
  const queue: Point[] = [a];
  prev.set(start, -1);
  while (queue.length) {
    const p = queue.shift()!;
    if (key(p) === goal) break;
    for (const n of [{ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 }]) {
      if (!isWalkable(n) || prev.has(key(n))) continue;
      prev.set(key(n), key(p));
      queue.push(n);
    }
  }
  if (!prev.has(goal)) return [a];
  const out: Point[] = [];
  for (let k = goal; k !== -1; k = prev.get(k)!) out.push({ x: k % GRID.w, y: Math.floor(k / GRID.w) });
  return out.reverse();
}
