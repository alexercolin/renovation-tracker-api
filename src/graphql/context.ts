import { type FastifyBaseLogger } from 'fastify';

import { type Container } from '../container.js';
import { type AuthService, type CurrentUser } from '../modules/auth/auth.service.js';
import { UnauthenticatedError } from '../shared/errors.js';
import { createLoaders, type Loaders } from './loaders.js';

export interface GraphQLContext {
  requestId: string;
  log: FastifyBaseLogger;
  currentUser: CurrentUser | null;
  services: Container['services'];
  loaders: Loaders;
}

export interface ContextSource {
  requestId: string;
  log: FastifyBaseLogger;
  authorization: unknown;
}

export async function buildContext(
  container: Container,
  source: ContextSource,
): Promise<GraphQLContext> {
  const currentUser = await authenticate(container.services.auth, source.authorization);
  return {
    requestId: source.requestId,
    log: source.log,
    currentUser,
    services: container.services,
    loaders: createLoaders(container.services),
  };
}

export function requireCurrentUser(ctx: GraphQLContext): CurrentUser {
  if (!ctx.currentUser) throw new UnauthenticatedError();
  return ctx.currentUser;
}

async function authenticate(auth: AuthService, header: unknown): Promise<CurrentUser | null> {
  if (header === undefined || header === null || header === '') return null;
  if (typeof header !== 'string') {
    throw new UnauthenticatedError('Malformed Authorization header');
  }
  const [scheme, token, ...rest] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length > 0) {
    throw new UnauthenticatedError('Malformed Authorization header');
  }
  return auth.verifyToken(token);
}
