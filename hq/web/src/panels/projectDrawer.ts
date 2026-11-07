// Project details: brief, founder actions, budget vs actual, task tree and deliverables.
import { api, baseName, fileUrl } from '../api.ts';
import { fmtUsd, h, mount, toast } from '../dom.ts';
import type { Approval, Budget, Project, Task } from '../../../src/types.ts';
import { openInspector } from './inspector.ts';

interface ProjectDetail {
  project: Project & { column: string };
  tasks: Task[];
  deliverables: { taskId: string; files: string[] }[];
  budget: Budget | null;
  actualAiUsd: number;
  approvals: Approval[];
}

let openId: string | null = null;
let titles: Record<string, string> = {};

export function setAgentTitles(t: Record<string, string>) { titles = t; }
export function refreshOpenProject() { if (openId) void openProject(openId, true); }

export function closeDrawer() {
  openId = null;
  document.getElementById('drawer')!.hidden = true;
}

export async function openProject(id: string, quiet = false) {
  const drawer = document.getElementById('drawer')!;
  let d: ProjectDetail;
  try { d = await api.get<ProjectDetail>(`/api/projects/${id}`); }
  catch (e) { if (!quiet) toast((e as Error).message); return; }
  openId = id;
  drawer.hidden = false;
  const p = d.project;

  const act = (url: string, body: object = {}, done = 'Done.') => async () => {
    try { await api.post(url, body); toast(done); void openProject(id, true); } catch (e) { toast((e as Error).message); }
  };
  const withFeedback = (url: string, decision: string, done: string) => async () => {
    const feedback = prompt('What should change?') ?? undefined;
    if (feedback === undefined) return;
    await act(url, { decision, feedback }, done)();
  };

  const actions: HTMLElement[] = [];
  if (p.status === 'idea') actions.push(h('button', { class: 'primary', onclick: act(`/api/projects/${id}/discuss`, {}, 'Sent to the CEO chat.') }, 'Discuss with CEO'));
  if (p.status === 'sharpening') actions.push(h('button', { class: 'primary', onclick: act(`/api/projects/${id}/accept-brief`, {}, 'Brief accepted. Conception starts.') }, 'Accept brief'));
  if (p.status === 'awaiting_approval') actions.push(
    h('button', { class: 'primary', onclick: act(`/api/projects/${id}/plan`, { decision: 'approve' }, 'Plan approved. Delivery starts.') }, 'Approve plan'),
    h('button', { onclick: withFeedback(`/api/projects/${id}/plan`, 'revise', 'Sent back for sharpening.') }, 'Revise'),
    h('button', { class: 'danger', onclick: act(`/api/projects/${id}/plan`, { decision: 'reject' }, 'Rejected.') }, 'Reject'));
  if (p.status === 'awaiting_founder') actions.push(
    h('button', { class: 'primary', onclick: act(`/api/projects/${id}/report`, { decision: 'accept' }, 'Delivery accepted.') }, 'Accept delivery'),
    h('button', { onclick: withFeedback(`/api/projects/${id}/report`, 'send_back', 'Sent back to the team.') }, 'Send back'));
  if (p.blocked) actions.push(h('button', { onclick: act(`/api/projects/${id}/unblock`, {}, 'Unblocked.') }, 'Unblock'));

  const budget = d.budget;
  const budgetView = budget ? h('table', { class: 'kv' },
    h('tr', {}, h('td', {}, 'Estimated AI usage'), h('td', {}, `${fmtUsd(budget.estimatedAiUsd)} (${budget.estimatedRuns} runs)`)),
    h('tr', {}, h('td', {}, 'Actual AI usage so far'), h('td', {}, fmtUsd(d.actualAiUsd))),
    budget.externalCosts.map(c => h('tr', {}, h('td', {}, c.item), h('td', {}, `${c.amount} ${c.currency} ${c.recurring === 'once' ? '' : `/ ${c.recurring.replace('ly', '')}`}`))),
    budget.clientPrice ? h('tr', {}, h('td', {}, 'Client price'), h('td', {}, `${budget.clientPrice.amount} ${budget.clientPrice.currency}`)) : null,
    budget.notes ? h('tr', {}, h('td', {}, 'Notes'), h('td', {}, budget.notes)) : null)
    : h('div', { class: 'muted' }, `No budget yet. AI usage so far: ${fmtUsd(d.actualAiUsd)} (API-equivalent).`);

  const byParent = (parentId: string | null) => d.tasks.filter(t => t.parentId === parentId);
  const node = (t: Task): HTMLElement => h('li', {},
    h('span', { class: `status ${t.status}` }, t.status.replace('_', ' ')), ' ',
    h('strong', {}, t.title), ' · ',
    h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); openInspector(t.assigneeId); } }, titles[t.assigneeId] ?? t.assigneeId),
    h('span', { class: 'muted small' }, ` · ${t.phase}${t.reworkCount ? ` · rework ${t.reworkCount}` : ''}`),
    t.failureReason ? h('div', { class: 'small', style: 'color:var(--bad)' }, t.failureReason) : null,
    t.resultSummary ? h('div', { class: 'small muted' }, t.resultSummary) : null,
    t.resultFiles.length ? h('div', { class: 'small' }, t.resultFiles.map(f => h('a', { href: fileUrl(f), style: 'margin-right:8px' }, baseName(f)))) : null,
    byParent(t.id).length ? h('ul', {}, byParent(t.id).map(node)) : null);

  mount(drawer,
    h('button', { class: 'close ghost', onclick: closeDrawer }, '✕'),
    h('h2', {}, p.title),
    h('div', { class: 'muted' }, `${p.id} · ${p.column.replace('_', ' ')}`),
    p.blocked ? h('div', { class: 'tag blocked' }, `Blocked: ${p.blockedReason}`) : null,
    actions.length ? h('div', { class: 'section row', style: 'display:flex;gap:8px;flex-wrap:wrap' }, actions) : null,
    h('div', { class: 'section' }, h('h3', {}, 'Brief'), h('div', { class: 'brief' }, p.brief || '(empty — sharpen it with the CEO)')),
    h('div', { class: 'section' }, h('h3', {}, 'Budget'), budgetView),
    h('div', { class: 'section' }, h('h3', {}, 'Work'), d.tasks.length ? h('ul', { class: 'tree' }, byParent(null).map(node)) : h('div', { class: 'muted' }, 'No tasks yet.')));
}
