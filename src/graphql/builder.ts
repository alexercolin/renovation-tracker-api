import SchemaBuilder from '@pothos/core';
import ScopeAuthPlugin from '@pothos/plugin-scope-auth';

import { ForbiddenError, UnauthenticatedError } from '../shared/errors.js';
import { type GraphQLContext } from './context.js';

export const builder = new SchemaBuilder<{
  Context: GraphQLContext;
  DefaultFieldNullability: false;
  DefaultInputFieldRequiredness: true;
  AuthScopes: {
    authenticated: boolean;
    contractor: boolean;
    homeowner: boolean;
  };
}>({
  plugins: [ScopeAuthPlugin],
  defaultFieldNullability: false,
  defaultInputFieldRequiredness: true,
  scopeAuth: {
    authScopes: (ctx) => ({
      authenticated: ctx.currentUser !== null,
      contractor: ctx.currentUser?.role === 'CONTRACTOR',
      homeowner: ctx.currentUser?.role === 'HOMEOWNER',
    }),
    unauthorizedError: (_parent, ctx) =>
      ctx.currentUser ? new ForbiddenError() : new UnauthenticatedError(),
  },
});

builder.queryType({});
builder.mutationType({});
