// The HQ web server: agent door (/internal), founder API (/api), live events (/ws), and the UI.
import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import type { EventBus } from '../events/bus.ts';
import type { Company } from '../domain/company.ts';
import type { TokenRegistry } from '../orchestrator/tokens.ts';
import { internalRoutes } from './internalRoutes.ts';
import { apiRoutes, type ApiDeps } from './apiRoutes.ts';
import { HQ_ROOT } from '../config.ts';

export interface AppDeps extends ApiDeps {
  bus: EventBus;
  company: Company;
  tokens: TokenRegistry;
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

function isLocalOrigin(origin: string): boolean {
  try { return LOCAL_HOSTS.has(new URL(origin).hostname); } catch { return false; }
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  // Only this machine's own pages may talk to HQ: blocks DNS rebinding, other websites reading
  // the event stream, and cross-site form posts.
  app.addHook('onRequest', async (req, reply) => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (!LOCAL_HOSTS.has(host)) return reply.code(403).send({ code: 'forbidden_host', message: 'HQ only answers on 127.0.0.1.' });
    const origin = req.headers.origin;
    if (origin && !isLocalOrigin(origin)) return reply.code(403).send({ code: 'forbidden_origin', message: 'Requests from other websites are refused.' });
    if ((req.method === 'POST' || req.method === 'PUT') && req.url.startsWith('/api/') && !(req.headers['content-type'] ?? '').includes('application/json')) {
      return reply.code(415).send({ code: 'json_only', message: 'Send JSON.' });
    }
  });
  app.register(internalRoutes({ company: deps.company, tokens: deps.tokens }));
  app.register(apiRoutes(deps));
  app.register(fastifyWebsocket);
  app.register(async scope => {
    scope.get('/ws', { websocket: true }, socket => {
      const off = deps.bus.on(e => socket.send(JSON.stringify(e)));
      socket.on('close', off);
    });
  });
  const dist = path.join(HQ_ROOT, 'web', 'dist');
  if (fs.existsSync(dist)) app.register(fastifyStatic, { root: dist });
  return app;
}
