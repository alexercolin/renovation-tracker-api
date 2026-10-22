import { type FastifyBaseLogger } from 'fastify';

export interface GraphQLContext {
  requestId: string;
  log: FastifyBaseLogger;
}
