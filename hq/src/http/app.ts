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

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
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
