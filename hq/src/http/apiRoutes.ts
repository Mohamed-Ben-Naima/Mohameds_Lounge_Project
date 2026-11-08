// /api/*: what the founder's browser uses. Reads company state; founder actions go through Company.
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import type { Db } from '../db/db.ts';
import * as projectsRepo from '../db/repos/projects.ts';
import * as tasksRepo from '../db/repos/tasks.ts';
import * as runsRepo from '../db/repos/runs.ts';
import * as approvalsRepo from '../db/repos/approvals.ts';
import * as budgetsRepo from '../db/repos/budgets.ts';
import * as auditRepo from '../db/repos/audit.ts';
import type { Company } from '../domain/company.ts';
import { PolicyError } from '../domain/errors.ts';
import { boardColumnOf } from '../domain/lifecycle.ts';
import type { RunQueue } from '../orchestrator/queue.ts';
import type { Workspaces } from '../workspace/workspaces.ts';
import type { ChatService } from '../ceo/chat.ts';
import { DEPARTMENTS, ROSTER, getAgent } from '../org/roster.ts';
import type { Config } from '../config.ts';
import type { Task } from '../types.ts';

export interface ApiDeps {
  config: Config;
  db: Db;
  company: Company;
  queue: RunQueue;
  ws: Workspaces;
  chat: ChatService;
  pump: () => void;
  retry: (projectId: string) => void;
}

type AgentState = 'idle' | 'working' | 'waiting' | 'blocked';

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof ZodError) return reply.code(400).send({ code: 'bad_request', message: err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
  if (err instanceof PolicyError) {
    const status = err.code === 'not_found' ? 404 : ['already_decided', 'bad_transition', 'wrong_status'].includes(err.code) ? 409 : 403;
    return reply.code(status).send({ code: err.code, message: err.message });
  }
  throw err;
}

export function apiRoutes(d: ApiDeps) {
  const roleOf = (id: string) => getAgent(id).role;

  const agentStates = () => {
    const running = runsRepo.listByStatus(d.db, 'running');
    const open = tasksRepo.listAll(d.db).filter(t => t.status !== 'done');
    return ROSTER.map(a => {
      const run = running.find(r => r.agentId === a.id);
      const mine = open.filter(t => t.assigneeId === a.id);
      const failed = mine.find(t => t.status === 'failed' && projectsRepo.get(d.db, t.projectId)?.blocked);
      const waiting = mine.find(t => t.status === 'waiting_subtasks' || t.status === 'in_review');
      const state: AgentState = run ? 'working' : failed ? 'blocked' : waiting ? 'waiting' : 'idle';
      const current = run?.taskId ?? (mine.find(t => t.status !== 'failed') ?? null)?.id ?? null;
      return { ...a, state, currentTaskId: current };
    });
  };

  const projectView = (id: string) => {
    const project = projectsRepo.get(d.db, id);
    if (!project) throw new PolicyError('not_found', 'No such project.');
    const tasks = tasksRepo.listByProject(d.db, id);
    return {
      project: { ...project, column: boardColumnOf(project, tasks, roleOf) },
      tasks,
      deliverables: tasks.filter(t => t.resultFiles.length).map(t => ({ taskId: t.id, files: t.resultFiles })),
      budget: budgetsRepo.get(d.db, id),
      actualAiUsd: runsRepo.sumCostByProject(d.db, id),
      approvals: approvalsRepo.listByProject(d.db, id),
    };
  };

  return async function plugin(app: FastifyInstance) {
    const action = <B>(schema: z.ZodType<B>, fn: (body: B, params: Record<string, string>) => unknown) =>
      async (req: { body: unknown; params: unknown }, reply: FastifyReply) => {
        try {
          const out = fn(schema.parse(req.body ?? {}), req.params as Record<string, string>);
          d.pump();
          return out ?? { ok: true };
        } catch (err) {
          return sendError(reply, err);
        }
      };

    app.get('/api/state', async () => {
      const all: Task[] = tasksRepo.listAll(d.db);
      return {
        companyName: d.config.companyName,
        departments: DEPARTMENTS,
        agents: agentStates(),
        projects: projectsRepo.list(d.db).map(p => ({ ...p, column: boardColumnOf(p, all.filter(t => t.projectId === p.id), roleOf) })),
        tasks: all,
        pendingApprovals: approvalsRepo.listPending(d.db),
        pausedUntil: d.queue.isPaused() ? d.queue.pausedUntil()!.toISOString() : null,
      };
    });

    app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
      try { return projectView(req.params.id); } catch (err) { return sendError(reply, err); }
    });

    app.get<{ Querystring: { path?: string } }>('/api/files', async (req, reply) => {
      const p = req.query.path ?? '';
      if (!p || !d.ws.isInsideProjects(p) || !fs.existsSync(p)) return reply.code(403).send({ code: 'not_allowed', message: 'Only project deliverables can be downloaded.' });
      reply.header('content-disposition', `attachment; filename="${path.basename(p)}"`);
      return reply.type('application/octet-stream').send(fs.createReadStream(p));
    });

    const decision = <T extends string>(...v: [T, ...T[]]) => z.object({ decision: z.enum(v), feedback: z.string().optional() });

    app.post('/api/ideas', action(z.object({ title: z.string().min(1), brief: z.string().default('') }),
      b => d.company.founderAddProject({ title: b.title, brief: b.brief, status: 'idea' })));
    app.post('/api/projects/:id/discuss', action(z.object({}), (_b, p) => {
      const project = d.company.startDiscussion(p.id);
      d.chat.send(`Let's sharpen "${project.title}" (${project.id}) together.${project.brief ? `\n\nWhat I have so far:\n${project.brief}` : ''}`);
      return project;
    }));
    app.post('/api/projects/:id/accept-brief', action(z.object({}), (_b, p) => d.company.acceptBrief(p.id)));
    app.post('/api/projects/:id/plan', action(decision('approve', 'revise', 'reject'), (b, p) => d.company.decidePlan(p.id, b.decision, b.feedback)));
    app.post('/api/projects/:id/report', action(decision('accept', 'send_back'), (b, p) => d.company.decideReport(p.id, b.decision, b.feedback)));
    app.post('/api/projects/:id/unblock', action(z.object({}), (_b, p) => { const project = d.company.unblock(p.id); d.retry(p.id); return project; }));
    app.post('/api/projects/:id/reject', action(z.object({}), (_b, p) => d.company.founderReject(p.id)));
    app.post('/api/approvals/:id', action(z.object({ decision: z.enum(['approve', 'reject']), editedContent: z.string().optional() }),
      (b, p) => d.company.decideApproval(p.id, b.decision, b.editedContent)));

    app.get('/api/chat', async () => d.chat.list());
    app.post('/api/chat', action(z.object({ text: z.string().min(1) }), b => d.chat.send(b.text)));

    app.get('/api/founder-profile', async () => ({ text: fs.readFileSync(d.ws.founderProfilePath(), 'utf8') }));
    app.put('/api/founder-profile', action(z.object({ text: z.string() }), b => {
      fs.writeFileSync(d.ws.founderProfilePath(), b.text);
      return { ok: true };
    }));

    app.post('/api/company/pause', action(z.object({}), () => d.queue.pause(new Date(Date.now() + 365 * 24 * 3600_000))));
    app.post('/api/company/resume', action(z.object({}), () => d.queue.resume()));

    app.get<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
      const agent = ROSTER.find(a => a.id === req.params.id);
      if (!agent) return reply.code(404).send({ code: 'not_found', message: 'No such agent.' });
      return {
        agent,
        notes: fs.existsSync(d.ws.notesPath(agent.id)) ? fs.readFileSync(d.ws.notesPath(agent.id), 'utf8') : '',
        recentRuns: runsRepo.listByAgent(d.db, agent.id, 10),
        recentAudit: auditRepo.listByActor(d.db, agent.id, 20),
      };
    });

    app.get<{ Querystring: { limit?: string } }>('/api/audit', async req => auditRepo.list(d.db, Math.min(Number(req.query.limit) || 100, 500)));
  };
}
