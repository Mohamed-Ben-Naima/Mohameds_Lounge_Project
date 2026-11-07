// The task board: every project in one of 10 columns.
import { BOARD_COLUMNS } from '../../../src/domain/lifecycle.ts';
import { api } from '../api.ts';
import { h, mount, toast } from '../dom.ts';
import { groupByColumn, type UiState } from '../store.ts';
import { openProject } from './projectDrawer.ts';

const FOUNDER_COLUMNS = new Set(['awaiting_approval', 'awaiting_founder']);

export function renderBoard(root: HTMLElement, s: UiState) {
  const groups = groupByColumn(s.projects);
  const head = h('div', { class: 'board-head' },
    h('h3', {}, 'Projects'),
    h('button', { class: 'primary', onclick: addIdea }, '+ Idea'));
  const cols = BOARD_COLUMNS.map(c => h('div', { class: `col${FOUNDER_COLUMNS.has(c.id) ? ' founder' : ''}` },
    h('h4', {}, h('span', {}, c.label), h('span', {}, String(groups[c.id].length))),
    groups[c.id].map(p => h('div', { class: 'card', onclick: () => openProject(p.id) },
      h('div', { class: 'title' }, p.title),
      p.blocked ? h('span', { class: 'tag blocked', title: p.blockedReason ?? '' }, 'Blocked') : null,
      h('div', { class: 'meta' },
        h('span', {}, `${s.tasks.filter(t => t.projectId === p.id && t.status === 'done').length}/${s.tasks.filter(t => t.projectId === p.id).length} tasks`),
        h('span', {}, p.id))))));
  mount(root, head, h('div', { class: 'board' }, cols));
}

async function addIdea() {
  const title = prompt('Idea title');
  if (!title) return;
  const brief = prompt('A few words about it (optional)') ?? '';
  try { await api.post('/api/ideas', { title, brief }); toast('Idea added to the board.'); }
  catch (e) { toast((e as Error).message); }
}
