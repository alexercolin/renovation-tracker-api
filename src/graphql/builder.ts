import SchemaBuilder from '@pothos/core';
import RelayPlugin from '@pothos/plugin-relay';
import ScopeAuthPlugin from '@pothos/plugin-scope-auth';
import { DateTimeResolver, JSONResolver } from 'graphql-scalars';

import { ForbiddenError, UnauthenticatedError } from '../shared/errors.js';
import { type GraphQLContext } from './context.js';

export const builder = new SchemaBuilder<{
  Context: GraphQLContext;
  DefaultFieldNullability: false;
  DefaultInputFieldRequiredness: true;
  Scalars: {
    ID: { Input: string; Output: string };
    DateTime: { Input: Date; Output: Date };
    JSON: { Input: unknown; Output: unknown };
  };
  AuthScopes: {
    authenticated: boolean;
    contractor: boolean;
    homeowner: boolean;
  };
}>({
  plugins: [ScopeAuthPlugin, RelayPlugin],
  relay: {
    clientMutationId: 'omit',
    cursorType: 'String',
  },
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

builder.addScalarType('DateTime', DateTimeResolver);
builder.addScalarType('JSON', JSONResolver);
builder.queryType({});
builder.mutationType({});
builder.subscriptionType({});
