// Office tab: the live pixel office.
import type { CompanyEvent } from '../../../src/events/bus.ts';
import type { UiState } from '../store.ts';
import { h, mount } from '../dom.ts';
import { createScene } from './scene.ts';
import { openInspector } from '../panels/inspector.ts';

export function mountOffice(root: HTMLElement, onState: (fn: (s: UiState, e: CompanyEvent | null) => void) => void) {
  const canvas = h('canvas', { 'aria-label': 'Pixel office: agents at work' }) as HTMLCanvasElement;
  const info = h('div', { class: 'muted small', style: 'margin-top:8px;text-align:center' });
  mount(root, h('div', { class: 'office-wrap' }, canvas), info);
  const scene = createScene(canvas, id => void openInspector(id));
  onState((s, e) => {
    scene.update(s, e);
    const working = s.agents.filter(a => a.state === 'working').length;
    info.textContent = `${working} of ${s.agents.length} agents working · click anyone to see what they are doing`;
  });
}
