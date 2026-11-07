// The HQ tools agents can call: name, description, input schema, and which Company method runs.
import { z } from 'zod';
import type { CallerCtx, Company } from '../domain/company.ts';

const currency = z.enum(['TND', 'EUR', 'USD']);
const files = z.array(z.string()).describe('Workspace-relative paths, e.g. outbox/<taskId>/report.md');

interface ToolDef {
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  run: (company: Company, c: CallerCtx, args: any) => unknown;
}

export const TOOL_CATALOG: Record<string, ToolDef> = {
  get_task: {
    description: 'Get your current task, its project and the files in your inbox.',
    schema: z.object({}),
    run: (co, c) => co.getTaskContext(c),
  },
  submit_result: {
    description: 'Submit your finished work once: a short summary and the output files from your outbox.',
    schema: z.object({ summary: z.string().min(1), files }),
    run: (co, c, a) => co.submitResult(c, a),
  },
  request_outbound: {
    description: 'Ask the founder to approve something that would leave the company (email, post, proposal, deployment, purchase). Nothing is sent without approval.',
    schema: z.object({
      kind: z.enum(['email', 'linkedin', 'post', 'proposal', 'deployment', 'purchase', 'other']),
      destination: z.string().min(1),
      subject: z.string().optional(),
      content: z.string().min(1),
      files: files.optional(),
    }),
    run: (co, c, a) => co.requestOutbound(c, a),
  },
  create_subtask: {
    description: 'Give one clear job to one of your own specialists.',
    schema: z.object({ assigneeId: z.string(), title: z.string().min(1), instructions: z.string().min(1), attachFiles: files.optional() }),
    run: (co, c, a) => co.createSubtask(c, a),
  },
  review_result: {
    description: 'Review a result you asked for: accept it, or ask for rework with concrete feedback.',
    schema: z.object({ taskId: z.string(), decision: z.enum(['accept', 'rework']), feedback: z.string() }),
    run: (co, c, a) => co.reviewResult(c, a),
  },
  request_cross_team: {
    description: 'Ask the CEO for help from another department.',
    schema: z.object({
      targetDept: z.enum(['conception', 'software_cloud', 'cybersecurity', 'network_infra', 'ai_automation', 'marketing_content', 'sales', 'finance_projects']),
      need: z.string().min(1),
    }),
    run: (co, c, a) => co.requestCrossTeam(c, a),
  },
  set_budget: {
    description: 'Record the project budget (CFO only, during Budgeting).',
    schema: z.object({
      estimatedRuns: z.number().int().nonnegative(),
      estimatedAiUsd: z.number().nonnegative(),
      externalCosts: z.array(z.object({
        item: z.string(), amount: z.number().nonnegative(), currency,
        recurring: z.enum(['once', 'monthly', 'yearly']), source: z.string().optional(),
      })),
      clientPrice: z.object({ amount: z.number().nonnegative(), currency }).nullable(),
      notes: z.string(),
    }),
    run: (co, c, a) => co.setBudget(c, a),
  },
  get_board: {
    description: 'See all projects and how many items wait for the founder.',
    schema: z.object({}),
    run: (co, c) => co.getBoard(c),
  },
  create_project: {
    description: 'Create a new project from the founder\'s idea or cahier des charges. It starts in Sharpening.',
    schema: z.object({ title: z.string().min(1), brief: z.string().min(1) }),
    run: (co, c, a) => co.createProject(c, a),
  },
  update_brief: {
    description: 'Replace the brief of a project that is still an idea or being sharpened.',
    schema: z.object({ projectId: z.string(), brief: z.string().min(1) }),
    run: (co, c, a) => co.updateBrief(c, a),
  },
  assign_to_lead: {
    description: 'Assign one clear delivery job to a department lead.',
    schema: z.object({ leadId: z.string(), title: z.string().min(1), instructions: z.string().min(1), attachFiles: files.optional() }),
    run: (co, c, a) => co.assignToLead(c, a),
  },
  decline_cross_team: {
    description: 'Decline a cross-team request with a reason.',
    schema: z.object({ requestId: z.string(), reason: z.string().min(1) }),
    run: (co, c, a) => co.declineCrossTeam(c, a),
  },
  recommend_outbound: {
    description: 'Advise the founder on an item waiting for approval.',
    schema: z.object({ approvalId: z.string(), recommendation: z.enum(['approve', 'edit', 'reject']), note: z.string() }),
    run: (co, c, a) => co.recommendOutbound(c, a),
  },
};

export function dispatch(company: Company, caller: CallerCtx, name: string, args: unknown): unknown {
  const tool = TOOL_CATALOG[name];
  if (!tool) throw new Error(`unknown tool ${name}`);
  return tool.run(company, caller, tool.schema.parse(args ?? {}));
}
