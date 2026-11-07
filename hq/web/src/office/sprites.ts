// Procedural 16×16 pixel characters: body in the department colour, CEO in navy with a gold tie,
// leads with a gold badge. No external art.
import type { Role } from '../../../src/types.ts';

export interface SpriteSet { idle: HTMLCanvasElement; walk: [HTMLCanvasElement, HTMLCanvasElement]; type: [HTMLCanvasElement, HTMLCanvasElement] }

const cache = new Map<string, SpriteSet>();

function shade(hex: string, f: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

function frame(color: string, kind: Role, legs: 0 | 1 | 2, arms: 0 | 1 | 2): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 16; cv.height = 16;
  const g = cv.getContext('2d')!;
  const px = (x: number, y: number, w: number, h: number, c: string) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const body = kind === 'ceo' ? '#24305a' : color;
  // shadow
  g.fillStyle = 'rgba(0,0,0,.35)';
  g.beginPath(); g.ellipse(8, 15, 5, 1.5, 0, 0, Math.PI * 2); g.fill();
  // legs
  const legY = 12;
  px(legs === 1 ? 4 : 5, legY, 2, legs === 2 ? 2 : 3, '#262633');
  px(legs === 2 ? 10 : 9, legY, 2, legs === 1 ? 2 : 3, '#262633');
  // body + arms
  px(4, 7, 8, 6, body);
  px(4, 7, 8, 1, shade(body.startsWith('#') ? body : '#888888', 1.25));
  const armY = arms === 1 ? 8 : arms === 2 ? 9 : 8;
  px(2, armY, 2, arms === 0 ? 5 : 3, shade(body.startsWith('#') ? body : '#888888', 0.75));
  px(12, arms === 2 ? 8 : armY, 2, arms === 0 ? 5 : 3, shade(body.startsWith('#') ? body : '#888888', 0.75));
  // head
  px(5, 2, 6, 5, '#e6bf98');
  px(5, 1, 6, 2, '#3a2a1f');
  px(6, 4, 1, 1, '#1a1a1a');
  px(9, 4, 1, 1, '#1a1a1a');
  if (kind === 'ceo') px(7, 7, 2, 4, '#ffd84d');
  if (kind === 'lead') px(10, 8, 1, 1, '#ffd84d');
  return cv;
}

export function makeSprites(color: string, kind: Role): SpriteSet {
  const key = `${color}:${kind}`;
  let s = cache.get(key);
  if (!s) {
    s = {
      idle: frame(color, kind, 0, 0),
      walk: [frame(color, kind, 1, 0), frame(color, kind, 2, 0)],
      type: [frame(color, kind, 0, 1), frame(color, kind, 0, 2)],
    };
    cache.set(key, s);
  }
  return s;
}
