import SchemaBuilder from '@pothos/core';

import { type GraphQLContext } from './context.js';

export const builder = new SchemaBuilder<{
  Context: GraphQLContext;
}>({});

builder.queryType({});
