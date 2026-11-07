// Agent inspector: who they are, what they are doing, their notes and recent actions.
import { api } from '../api.ts';
import { fmtTime, fmtUsd, h, mount, toast } from '../dom.ts';
import type { AgentDef, AuditEntry, Run } from '../../../src/types.ts';
import { closeDrawer } from './projectDrawer.ts';

interface AgentDetail { agent: AgentDef; notes: string; recentRuns: Run[]; recentAudit: AuditEntry[] }

let titles: Record<string, string> = {};
export function setInspectorTitles(t: Record<string, string>) { titles = t; }

export async function openInspector(agentId: string) {
  const drawer = document.getElementById('drawer')!;
  let d: AgentDetail;
  try { d = await api.get<AgentDetail>(`/api/agents/${agentId}`); } catch (e) { toast((e as Error).message); return; }
  drawer.hidden = false;
  const a = d.agent;
  mount(drawer,
    h('button', { class: 'close ghost', onclick: closeDrawer }, '✕'),
    h('h2', {}, a.title),
    h('div', { class: 'muted' }, `${a.section} · reports to ${a.leadId ? titles[a.leadId] ?? a.leadId : 'the founder'} · tools: ${a.toolProfile}`),
    h('div', { class: 'section' }, h('h3', {}, 'Job'), h('ul', {}, a.duties.map(x => h('li', {}, x)))),
    h('div', { class: 'section' }, h('h3', {}, 'Recent runs'),
      d.recentRuns.length ? h('table', { class: 'kv' }, d.recentRuns.map(r => h('tr', {},
        h('td', {}, r.createdAt ? fmtTime(r.createdAt) : ''), h('td', {}, r.purpose), h('td', {}, h('span', { class: `status ${r.status}` }, r.status)),
        h('td', {}, fmtUsd(r.costUsd)), h('td', { class: 'small muted' }, r.error ?? '')))) : h('div', { class: 'muted' }, 'No runs yet.')),
    h('div', { class: 'section' }, h('h3', {}, 'Recent actions'),
      d.recentAudit.length ? h('table', { class: 'kv' }, d.recentAudit.map(e => h('tr', {},
        h('td', {}, fmtTime(e.at)), h('td', {}, e.action), h('td', { class: 'small muted' }, e.entityId)))) : h('div', { class: 'muted' }, 'No actions yet.')),
    h('div', { class: 'section' }, h('h3', {}, 'Notes'), h('div', { class: 'brief' }, d.notes)));
}
