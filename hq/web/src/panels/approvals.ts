// The founder's inbox: outbound items held by the Gate, plans and deliveries to sign off, blocked projects.
import { api, baseName, fileUrl } from '../api.ts';
import { h, mount, toast } from '../dom.ts';
import type { UiState } from '../store.ts';
import type { Approval } from '../../../src/types.ts';
import { openProject } from './projectDrawer.ts';

let lastApproved: { approval: Approval; content: string } | null = null;

export function renderInbox(root: HTMLElement, s: UiState) {
  const title = (agentId: string) => s.agents.find(a => a.id === agentId)?.title ?? agentId;
  const decisions = s.projects.filter(p => p.status === 'awaiting_approval' || p.status === 'awaiting_founder' || p.blocked);

  const approved = lastApproved ? h('div', { class: 'item' },
    h('strong', {}, `Approved: ${lastApproved.approval.kind} to ${lastApproved.approval.destination}`),
    h('div', { class: 'muted small' }, 'Nothing was sent. Send it yourself:'),
    h('div', { class: 'brief' }, lastApproved.content),
    h('div', { class: 'row' },
      h('button', { onclick: () => navigator.clipboard.writeText(lastApproved!.content).then(() => toast('Copied.')) }, 'Copy'),
      lastApproved.approval.files.map(f => h('a', { href: fileUrl(f) }, baseName(f))),
      h('button', { class: 'ghost', onclick: () => { lastApproved = null; renderInbox(root, s); } }, 'Dismiss'))) : null;

  const items = s.pendingApprovals.map(a => {
    const text = h('textarea', { rows: 6 }) as HTMLTextAreaElement;
    text.value = a.content;
    const decide = async (decision: 'approve' | 'reject') => {
      try {
        await api.post(`/api/approvals/${a.id}`, { decision, editedContent: text.value });
        if (decision === 'approve') lastApproved = { approval: a, content: text.value };
        toast(decision === 'approve' ? 'Approved. Copy it and send it yourself.' : 'Rejected.');
      } catch (e) { toast((e as Error).message); }
    };
    return h('div', { class: 'item' },
      h('strong', {}, `${a.kind} → ${a.destination}`),
      h('div', { class: 'muted small' }, `From ${title(a.agentId)}${a.subject ? ` · ${a.subject}` : ''}`),
      a.ceoRecommendation
        ? h('div', { class: 'rec' }, h('strong', {}, `CEO recommends: ${a.ceoRecommendation}. `), a.ceoNote ?? '')
        : h('div', { class: 'rec muted' }, 'Waiting for the CEO\'s recommendation…'),
      text,
      a.files.length ? h('div', { class: 'row' }, a.files.map(f => h('a', { href: fileUrl(f) }, baseName(f)))) : null,
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => decide('approve') }, 'Approve'),
        h('button', { class: 'danger', onclick: () => decide('reject') }, 'Reject')));
  });

  const projectItems = decisions.map(p => h('div', { class: 'item', onclick: () => openProject(p.id), style: 'cursor:pointer' },
    h('strong', {}, p.title),
    h('div', { class: 'muted small' },
      p.blocked ? `Blocked: ${p.blockedReason}` : p.status === 'awaiting_approval' ? 'Design and budget ready: approve the plan' : 'Delivery ready: accept or send back')));

  mount(root,
    approved,
    h('h4', {}, 'Held by the Gate'),
    items.length ? items : h('div', { class: 'muted' }, 'Nothing is waiting to leave the company.'),
    h('h4', {}, 'Decisions'),
    projectItems.length ? projectItems : h('div', { class: 'muted' }, 'No decisions waiting.'));
}
