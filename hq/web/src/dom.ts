// Tiny DOM helper: h('div', {class: 'x', onclick}, 'text', child).
type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | ((e: any) => void) | undefined>;

export function h(tag: string, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function mount(parent: HTMLElement, ...children: (Child | Child[])[]) {
  parent.replaceChildren();
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) parent.append(c instanceof Node ? c : String(c));
}

let toastTimer: number | undefined;
export function toast(text: string) {
  const el = document.getElementById('toast')!;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.hidden = true; }, 3500);
}

export const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
