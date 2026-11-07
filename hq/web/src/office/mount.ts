// Office tab mount point. Task 13 replaces the placeholder with the pixel office scene.
import type { CompanyEvent } from '../../../src/events/bus.ts';
import type { UiState } from '../store.ts';
import { h, mount } from '../dom.ts';

export function mountOffice(root: HTMLElement, onState: (fn: (s: UiState, e: CompanyEvent | null) => void) => void) {
  const info = h('div', { class: 'muted' });
  mount(root, h('h3', {}, 'Office'), info);
  onState(s => { info.textContent = `${s.agents.filter(a => a.state === 'working').length} of ${s.agents.length} agents working.`; });
}
