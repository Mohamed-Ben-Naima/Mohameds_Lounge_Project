// /internal/*: the only door agents have into the company. Every call carries a run token;
// HQ looks up who is calling and refuses anything their role does not allow.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import type { Company, CallerCtx } from '../domain/company.ts';
import { PolicyError } from '../domain/errors.ts';
import type { TokenRegistry } from '../orchestrator/tokens.ts';
import { getAgent } from '../org/roster.ts';
import { mcpToolsFor } from '../runner/toolProfiles.ts';
import { TOOL_CATALOG, dispatch } from '../mcp/catalog.ts';

export function internalRoutes(deps: { company: Company; tokens: TokenRegistry }) {
  return async function plugin(app: FastifyInstance) {
    const caller = (req: FastifyRequest, reply: FastifyReply): CallerCtx | null => {
      const header = req.headers.authorization ?? '';
      const ctx = header.startsWith('Bearer ') ? deps.tokens.resolve(header.slice(7)) : null;
      if (!ctx) reply.code(401).send({ code: 'unauthorized', message: 'Unknown or expired run token.' });
      return ctx;
    };

    app.get('/internal/tools', async (req, reply) => {
      const c = caller(req, reply);
      if (!c) return reply;
      return mcpToolsFor(getAgent(c.agentId)).map(name => ({
        name, description: TOOL_CATALOG[name].description, inputSchema: z.toJSONSchema(TOOL_CATALOG[name].schema),
      }));
    });

    app.post<{ Params: { name: string }; Body: { args?: unknown } }>('/internal/tool/:name', async (req, reply) => {
      const c = caller(req, reply);
      if (!c) return reply;
      const name = req.params.name;
      if (!mcpToolsFor(getAgent(c.agentId)).includes(name)) {
        return reply.code(403).send({ code: 'not_allowed', message: `Your role cannot use ${name}.` });
      }
      try {
        return { result: dispatch(deps.company, c, name, req.body?.args) };
      } catch (err) {
        if (err instanceof ZodError) return reply.code(400).send({ code: 'bad_args', message: err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
        if (err instanceof PolicyError) return reply.code(403).send({ code: err.code, message: err.message });
        throw err;
      }
    });
  };
}
