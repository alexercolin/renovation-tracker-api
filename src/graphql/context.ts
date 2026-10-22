import { type FastifyBaseLogger, type FastifyRequest } from 'fastify';

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

export async function buildContext(
  container: Container,
  req: FastifyRequest,
): Promise<GraphQLContext> {
  const currentUser = await authenticate(container.services.auth, req.headers.authorization);
  return {
    requestId: req.id,
    log: req.log,
    currentUser,
    services: container.services,
    loaders: createLoaders(container.services),
  };
}

export function requireCurrentUser(ctx: GraphQLContext): CurrentUser {
  if (!ctx.currentUser) throw new UnauthenticatedError();
  return ctx.currentUser;
}

async function authenticate(
  auth: AuthService,
  header: string | undefined,
): Promise<CurrentUser | null> {
  if (!header) return null;
  const [scheme, token, ...rest] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length > 0) {
    throw new UnauthenticatedError('Malformed Authorization header');
  }
  return auth.verifyToken(token);
}
