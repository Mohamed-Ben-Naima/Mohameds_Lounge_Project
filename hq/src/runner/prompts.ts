// Job descriptions (system prompt appendix) and per-purpose task prompts (stdin).
import type { AgentDef, Approval, CrossTeamRequest, Project, RunPurpose, Task } from '../types.ts';
import { DEPARTMENTS, getAgent } from '../org/roster.ts';
import { directReports } from '../org/hierarchy.ts';

export function jobDescription(agent: AgentDef, companyName: string): string {
  const dept = DEPARTMENTS.find(d => d.id === agent.dept);
  const reviewerTitle = agent.leadId ? getAgent(agent.leadId).title : 'the founder';
  const isLead = agent.role === 'lead';
  const lines: string[] = [
    `# Your role at ${companyName}`,
    '',
    `You are the **${agent.title}**${dept ? ` in the ${dept.name} department` : ''}. Your section: ${agent.section}.`,
    `${companyName} is an IT-services company run by AI agents: one CEO, eight department leads and their specialists. The founder is the human owner.`,
    `You report to ${reviewerTitle}.`,
  ];
  if (isLead) lines.push(`Your team: ${directReports(agent.id).map(r => `${r.title} (id: ${r.id}, ${r.section})`).join('; ')}.`);
  if (agent.role === 'ceo') lines.push(`Your leads: ${DEPARTMENTS.map(d => `${getAgent(d.leadId).title} (id: ${d.leadId}, ${d.name})`).join('; ')}.`);
  lines.push(
    '',
    '## Your job',
    ...agent.duties.map(d => `- ${d}`),
    '',
    '## Not your job',
    ...agent.notDuties.map(d => `- ${d}`),
    '- Anything that belongs to another team',
    '',
    '## Rules',
    `1. You take work only from ${reviewerTitle}. You never contact other agents; the hq tools are your only way to act on the company.`,
    `2. Do only your own section's work. If a task needs another team, say so in your result${isLead ? ' or use request_cross_team' : ''}.`,
    '3. Nothing leaves this machine except through request_outbound, which the founder approves. You have no accounts or credentials for external services; never ask for them.',
    '4. You may search and read the web for research. Cite every external fact with its URL and the date you read it.',
    '5. When you are done, call submit_result exactly once with a short summary and the files you produced.',
    '6. Reply in the language the founder used.',
    '',
    '## Your desk',
    '- Read notes.md at the start of every task and append short lessons at the end.',
    '- Your inputs are in inbox/ (read-only). Write every output file in outbox/<taskId>/ and list those paths in submit_result.',
    '- Keep results focused: one clear deliverable per task, no filler.',
  );
  if (agent.id === 'pentester') {
    lines.push('', '## Important', 'Active testing is disabled. Produce plans, methodologies and reports only. Never scan, probe or attack any system.');
  }
  if (isLead) {
    lines.push('', '## As a lead',
      'Split your task into subtasks for your specialists with create_subtask, one clear job each, and do it yourself only if it is tiny.',
      'Review honestly; when you ask for rework, give concrete feedback.',
      'When all subtasks are finished you will be asked to compile them into one result for the CEO.');
  }
  if (agent.role === 'ceo') {
    lines.push('', '## As CEO',
      'You talk to the founder and delegate only to department leads. You never do department work yourself.',
      'Keep founder-profile.md up to date with how the founder works: standards, preferences, decisions.',
      'Be concise and concrete with the founder. Ask one question at a time when something is unclear.');
  }
  return lines.join('\n');
}

export interface PromptCtx {
  task?: Task;
  project?: Project;
  inboxFiles: string[];
  reviewOf?: { task: Task; submitterTitle: string; files: string[] };
  subtasks?: Task[];
  approval?: Approval;
  crossTeam?: CrossTeamRequest;
  founderMessage?: string;
  boardSummary?: string;
}

const fileList = (files: string[]) => (files.length ? files.map(f => `- ${f}`).join('\n') : '- (none)');

function taskHeader(t: Task, project?: Project): string {
  return [
    project ? `Project: ${project.title} (${project.id})` : '',
    `Task ${t.id}: ${t.title}`,
    '',
    'Instructions:',
    t.instructions,
  ].filter(Boolean).join('\n');
}

export function taskPrompt(purpose: RunPurpose, ctx: PromptCtx): string {
  const t = ctx.task;
  switch (purpose) {
    case 'work': {
      if (!t) throw new Error('work prompt needs a task');
      return [
        taskHeader(t, ctx.project),
        t.feedback && t.reworkCount > 0 ? `\nYour lead asked for changes:\n${t.feedback}` : '',
        `\nInput files:\n${fileList(ctx.inboxFiles)}`,
        `\nWrite your output files in outbox/${t.id}/.`,
        'Finish by calling submit_result once with a short summary and your file paths.',
      ].filter(Boolean).join('\n');
    }
    case 'review': {
      const r = ctx.reviewOf;
      if (!r) throw new Error('review prompt needs reviewOf');
      return [
        `Review task ${r.task.id}: "${r.task.title}", submitted by the ${r.submitterTitle}.`,
        '',
        'What you asked for:',
        r.task.instructions,
        '',
        'Their summary:',
        r.task.resultSummary ?? '(no summary)',
        '',
        `Their files:\n${fileList(r.files)}`,
        '',
        `Check the work against the instructions. Call review_result once with taskId "${r.task.id}", decision "accept" or "rework", and concrete feedback.`,
      ].join('\n');
    }
    case 'compile': {
      if (!t) throw new Error('compile prompt needs a task');
      const subs = (ctx.subtasks ?? []).map(s =>
        `- ${s.id} "${s.title}" (${getAgent(s.assigneeId).title}): ${s.status}${s.failureReason ? ` — ${s.failureReason}` : ''}\n  ${s.resultSummary ?? ''}`);
      return [
        taskHeader(t, ctx.project),
        t.feedback && t.reworkCount > 0 ? `\nThe CEO asked for changes:\n${t.feedback}\nYou may create new subtasks if needed.` : '',
        '',
        'All your subtasks are finished:',
        ...subs,
        `\nTheir files are in your inbox:\n${fileList(ctx.inboxFiles)}`,
        `\nCompile one result for the CEO in outbox/${t.id}/. Mention any failed subtask honestly.`,
        'Finish by calling submit_result once.',
      ].join('\n');
    }
    case 'plan_delivery': {
      const p = ctx.project;
      if (!p) throw new Error('plan_delivery prompt needs a project');
      return [
        `The founder approved the design and budget for "${p.title}" (${p.id}).`,
        '',
        'Brief:',
        p.brief,
        `\nDesign and budget files:\n${fileList(ctx.inboxFiles)}`,
        '',
        'Plan the delivery: call assign_to_lead once for each department needed, with one clear job each and the relevant files in attachFiles.',
        'Do not do the work yourself. When you have assigned everything, reply with a one-paragraph plan.',
      ].join('\n');
    }
    case 'triage': {
      const r = ctx.crossTeam;
      if (!r) throw new Error('triage prompt needs a cross-team request');
      return [
        `The ${getAgent(r.fromAgentId).title} needs help from another department (${r.targetDept}) on project ${r.projectId}.`,
        `Request ${r.id}: ${r.need}`,
        '',
        'Decide: call assign_to_lead for the lead of that department with a clear task, or decline_cross_team with a reason.',
      ].join('\n');
    }
    case 'recommend': {
      const a = ctx.approval;
      if (!a) throw new Error('recommend prompt needs an approval');
      return [
        `The ${getAgent(a.agentId).title} wants to send something outside the company. The founder decides; you advise.`,
        `Kind: ${a.kind}\nTo: ${a.destination}${a.subject ? `\nSubject: ${a.subject}` : ''}`,
        '',
        'Content:',
        a.content,
        '',
        `Call recommend_outbound once with approvalId "${a.id}", recommendation "approve", "edit" or "reject", and a short note for the founder.`,
      ].join('\n');
    }
    case 'chat':
      return [
        'The founder says:',
        ctx.founderMessage ?? '',
        '',
        'Current board:',
        ctx.boardSummary ?? '(no projects)',
        '',
        'Reply to the founder in plain text. If they bring a new idea or a ready cahier des charges, call create_project.',
        'While sharpening a project, keep its brief current with update_brief.',
        'When the founder agrees the brief is final, tell them to click "Accept brief" on the project card.',
        'If you learn something about how the founder works, update founder-profile.md.',
      ].join('\n');
  }
}
