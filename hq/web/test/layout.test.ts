import { expect, test } from 'vitest';
import { GRID, ROOMS, deskOf, isWalkable, pathBetween, roomAt, spotIn } from '../src/office/layout.ts';
import { ROSTER, getAgent } from '../../src/org/roster.ts';

const deptOf = (id: string) => getAgent(id).dept;

test('every agent has a desk inside its own room', () => {
  const desks = new Set<string>();
  for (const a of ROSTER) {
    const d = deskOf(a.id, deptOf);
    const room = roomAt(d);
    expect(room?.id, a.id).toBe(a.dept ?? 'ceo');
    expect(isWalkable(d), a.id).toBe(true);
    desks.add(`${d.x},${d.y}`);
  }
  expect(desks.size).toBe(ROSTER.length);
});

test('layout has founder, ceo, meeting, board and 8 department rooms inside the grid', () => {
  expect(ROOMS.map(r => r.id).sort()).toEqual(['ai_automation', 'board', 'ceo', 'conception', 'cybersecurity', 'finance_projects', 'founder', 'marketing_content', 'meeting', 'network_infra', 'sales', 'software_cloud'].sort());
  for (const r of ROOMS) {
    expect(r.rect.x + r.rect.w).toBeLessThanOrEqual(GRID.w);
    expect(r.rect.y + r.rect.h).toBeLessThanOrEqual(GRID.h);
    expect(isWalkable(r.door)).toBe(true);
  }
});

function expectValidPath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const path = pathBetween(from, to);
  expect(path[0]).toEqual(from);
  expect(path[path.length - 1]).toEqual(to);
  for (let i = 1; i < path.length; i++) {
    const dx = Math.abs(path[i].x - path[i - 1].x), dy = Math.abs(path[i].y - path[i - 1].y);
    expect(dx + dy).toBe(1);
    expect(isWalkable(path[i])).toBe(true);
  }
}

test('pathBetween is axis-aligned, walkable, and ends at target', () => {
  expectValidPath(deskOf('chief-architect', deptOf), spotIn('ceo'));
  expectValidPath(deskOf('cost-controller', deptOf), spotIn('board'));
  expectValidPath(deskOf('content-creator', deptOf), deskOf('cmo', deptOf));
  expectValidPath(deskOf('ceo', deptOf), spotIn('founder'));
});
