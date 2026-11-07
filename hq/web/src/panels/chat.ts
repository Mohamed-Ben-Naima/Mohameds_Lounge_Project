// The founder's chat with the CEO.
import { api } from '../api.ts';
import { fmtTime, h, toast } from '../dom.ts';
import type { UiState } from '../store.ts';

let log: HTMLElement;

export function initChat(root: HTMLElement) {
  log = h('div', { class: 'chat-log' });
  const input = h('textarea', { placeholder: 'Talk to your CEO: an idea, a cahier des charges, a question…', rows: 3 }) as HTMLTextAreaElement;
  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try { await api.post('/api/chat', { text }); } catch (e) { toast((e as Error).message); input.value = text; }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); });
  root.append(
    h('div', { class: 'muted small' }, 'Only the CEO talks to you. Ctrl+Enter to send.'),
    log,
    h('div', { class: 'chat-form' }, input, h('button', { class: 'primary', onclick: send }, 'Send to CEO')),
  );
}

export function renderChat(s: UiState) {
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.replaceChildren(...s.chat.map(m => h('div', { class: `msg ${m.role}` },
    h('div', { class: 'who' }, `${m.role === 'ceo' ? 'CEO' : 'You'} · ${fmtTime(m.at)}`), m.text)));
  const ceo = s.agents.find(a => a.id === 'ceo');
  const last = s.chat[s.chat.length - 1];
  if (ceo?.state === 'working' && last?.role === 'founder') log.append(h('div', { class: 'thinking' }, 'CEO is thinking…'));
  if (atBottom) log.scrollTop = log.scrollHeight;
}
