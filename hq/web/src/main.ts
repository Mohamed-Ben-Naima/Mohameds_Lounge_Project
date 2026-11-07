// Founder UI: loads company state, keeps it live over WebSocket, renders the panels.
import { api } from './api.ts';
import { fmtTime, h, mount, toast } from './dom.ts';
import { inboxCount, reduce, type UiState } from './store.ts';
import type { CompanyEvent } from '../../src/events/bus.ts';
import type { ChatMessage } from '../../src/types.ts';
import { renderBoard } from './panels/board.ts';
import { initChat, renderChat } from './panels/chat.ts';
import { renderInbox } from './panels/approvals.ts';
import { refreshOpenProject, setAgentTitles } from './panels/projectDrawer.ts';
import { setInspectorTitles } from './panels/inspector.ts';
import { mountOffice } from './office/mount.ts';

const $ = (id: string) => document.getElementById(id)!;
let state: UiState | null = null;
const listeners: ((s: UiState, e: CompanyEvent | null) => void)[] = [];
export const onState = (fn: (s: UiState, e: CompanyEvent | null) => void) => listeners.push(fn);

async function load() {
  const [s, chat] = await Promise.all([api.get<Omit<UiState, 'chat'>>('/api/state'), api.get<ChatMessage[]>('/api/chat')]);
  state = { ...s, chat };
  const titles = Object.fromEntries(state.agents.map(a => [a.id, a.title]));
  setAgentTitles(titles);
  setInspectorTitles(titles);
  render(null);
}

function render(e: CompanyEvent | null) {
  if (!state) return;
  const s = state;
  document.title = s.companyName;
  $('company-name').textContent = s.companyName;
  const count = inboxCount(s);
  $('inbox-count').textContent = String(count);
  $('inbox-count').className = `badge${count ? '' : ' zero'}`;
  const banner = $('paused-banner');
  const paused = s.pausedUntil && new Date(s.pausedUntil) > new Date();
  banner.hidden = !paused;
  if (paused) {
    const until = new Date(s.pausedUntil!);
    banner.textContent = until.getFullYear() > new Date().getFullYear() ? 'Company paused by you' : `Company on break until ${fmtTime(s.pausedUntil!)}`;
  }
  $('pause-btn').textContent = paused ? 'Resume company' : 'Pause company';
  renderBoard($('board-view'), s);
  renderChat(s);
  renderInbox($('inbox-view'), s);
  for (const fn of listeners) fn(s, e);
}

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onmessage = msg => {
    const e = JSON.parse(msg.data) as CompanyEvent;
    if (!state) return;
    state = reduce(state, e);
    render(e);
    if (e.type.startsWith('task.') || e.type.startsWith('project.') || e.type === 'budget.updated') refreshOpenProject();
  };
  ws.onclose = () => setTimeout(() => { connect(); void load(); }, 2000);
}

function tabs(navId: string, views: Record<string, string>) {
  const nav = $(navId);
  const show = (tab: string) => {
    for (const b of nav.querySelectorAll('button')) b.classList.toggle('active', b.dataset.tab === tab);
    for (const [k, id] of Object.entries(views)) $(id).hidden = k !== tab;
  };
  nav.addEventListener('click', e => {
    const tab = (e.target as HTMLElement).dataset.tab;
    if (tab) show(tab);
  });
  return show;
}

async function initProfile(root: HTMLElement) {
  const text = h('textarea', { rows: 18 }) as HTMLTextAreaElement;
  const reload = async () => { text.value = (await api.get<{ text: string }>('/api/founder-profile')).text; };
  const save = async () => { try { await api.put('/api/founder-profile', { text: text.value }); toast('Saved.'); } catch (e) { toast((e as Error).message); } };
  mount(root,
    h('div', { class: 'muted small' }, 'What the CEO knows about how you work. The CEO updates it; you can correct it.'),
    text,
    h('div', { style: 'display:flex;gap:8px' }, h('button', { class: 'primary', onclick: save }, 'Save'), h('button', { onclick: reload }, 'Reload')));
  await reload();
}

tabs('main-tabs', { office: 'office-view', board: 'board-view' });
const showSide = tabs('side-tabs', { chat: 'chat-view', inbox: 'inbox-view', profile: 'profile-view' });
$('inbox-btn').addEventListener('click', () => showSide('inbox'));
$('pause-btn').addEventListener('click', async () => {
  const paused = state?.pausedUntil && new Date(state.pausedUntil) > new Date();
  try { await api.post(paused ? '/api/company/resume' : '/api/company/pause'); } catch (e) { toast((e as Error).message); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('drawer').hidden = true; });

initChat($('chat-view'));
void initProfile($('profile-view'));
mountOffice($('office-view'), onState);
await load();
connect();
setInterval(() => void load(), 20_000);
