import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import {
  type DocumentNode,
  type ExecutionArgs,
  type GraphQLError,
  type GraphQLSchema,
} from 'graphql';
import { type OperationResult } from 'graphql-ws';
import { makeHandler } from 'graphql-ws/use/@fastify/websocket';
import { createYoga, type YogaLogger } from 'graphql-yoga';
import { type Logger } from 'pino';

import { type Container } from './container.js';
import { buildContext, type GraphQLContext } from './graphql/context.js';
import { maskError } from './graphql/errors.js';
import { schema } from './graphql/schema.js';

interface ServerContext {
  req: FastifyRequest;
  reply?: FastifyReply;
  connectionParams?: Record<string, unknown>;
}

interface EnvelopedRoot {
  execute: (args: ExecutionArgs) => OperationResult;
  subscribe: (args: ExecutionArgs) => OperationResult;
}

interface Enveloped extends EnvelopedRoot {
  schema: GraphQLSchema;
  parse: (source: string) => DocumentNode;
  validate: (schema: GraphQLSchema, document: DocumentNode) => readonly GraphQLError[];
  contextFactory: () => Promise<unknown>;
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
  const isDev = container.env.NODE_ENV !== 'production';
  const app = Fastify({
    loggerInstance: container.logger,
    requestIdHeader: 'x-request-id',
  });

  const yoga = createYoga<ServerContext, GraphQLContext>({
    schema,
    graphqlEndpoint: '/graphql',
    logging: toYogaLogger(container.logger),
    maskedErrors: { maskError, isDev },
    context: ({ req, connectionParams }) =>
      buildContext(container, {
        requestId: req.id,
        log: req.log,
        authorization: connectionParams?.authorization ?? req.headers.authorization,
      }),
  });

  await app.register(fastifyWebsocket);

  app.addContentTypeParser('multipart/form-data', {}, (_req, _payload, done) => done(null));

  const handleHttp = async (req: FastifyRequest, reply: FastifyReply) => {
    const response = await yoga.handleNodeRequestAndResponse(req, reply, { req, reply });
    response.headers.forEach((value, key) => {
      reply.header(key, value);
    });
    reply.status(response.status);
    return reply.send(response.body);
  };

  app.route({
    url: yoga.graphqlEndpoint,
    method: ['POST', 'OPTIONS'],
    handler: handleHttp,
  });

  app.route({
    url: yoga.graphqlEndpoint,
    method: 'GET',
    handler: handleHttp,
    wsHandler: makeHandler({
      isProd: !isDev,
      execute: (args) => (args.rootValue as EnvelopedRoot).execute(args),
      subscribe: (args) => (args.rootValue as EnvelopedRoot).subscribe(args),
      onSubscribe: async (ctx, _id, payload) => {
        const {
          schema: enveloped,
          execute,
          subscribe,
          contextFactory,
          parse,
          validate,
        } = yoga.getEnveloped({
          req: ctx.extra.request,
          connectionParams: ctx.connectionParams as Record<string, unknown> | undefined,
        }) as Enveloped;

        const document = parse(payload.query);
        const errors = validate(enveloped, document);
        if (errors.length > 0) return errors;

        try {
          return {
            schema: enveloped,
            operationName: payload.operationName,
            document,
            variableValues: payload.variables,
            contextValue: await contextFactory(),
            rootValue: { execute, subscribe },
          };
        } catch (error) {
          return [maskError(error, 'Unexpected error.', isDev) as GraphQLError];
        }
      },
    }),
  });

  app.get('/healthz', () => ({ status: 'ok' }));

  await app.ready();
  return app;
}
