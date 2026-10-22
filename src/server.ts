import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { createYoga, type YogaLogger } from 'graphql-yoga';
import { type Logger } from 'pino';

import { type Container } from './container.js';
import { buildContext, type GraphQLContext } from './graphql/context.js';
import { maskError } from './graphql/errors.js';
import { schema } from './graphql/schema.js';

interface ServerContext {
  req: FastifyRequest;
  reply: FastifyReply;
}

function toYogaLogger(logger: Logger): YogaLogger {
  const format = (args: unknown[]) =>
    args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
  return {
    debug: (...args) => logger.debug(format(args)),
    info: (...args) => logger.info(format(args)),
    warn: (...args) => logger.warn(format(args)),
    error: (...args) => logger.error(format(args)),
  };
}

export async function buildServer(container: Container) {
  const app = Fastify({
    loggerInstance: container.logger,
    requestIdHeader: 'x-request-id',
  });

  const yoga = createYoga<ServerContext, GraphQLContext>({
    schema,
    graphqlEndpoint: '/graphql',
    logging: toYogaLogger(container.logger),
    maskedErrors: { maskError, isDev: container.env.NODE_ENV !== 'production' },
    context: ({ req }) => buildContext(container, req),
  });

  app.addContentTypeParser('multipart/form-data', {}, (_req, _payload, done) => done(null));

  app.route({
    url: yoga.graphqlEndpoint,
    method: ['GET', 'POST', 'OPTIONS'],
    handler: async (req, reply) => {
      const response = await yoga.handleNodeRequestAndResponse(req, reply, { req, reply });
      response.headers.forEach((value, key) => {
        reply.header(key, value);
      });
      reply.status(response.status);
      return reply.send(response.body);
    },
  });

  app.get('/healthz', () => ({ status: 'ok' }));

  await app.ready();
  return app;
}
