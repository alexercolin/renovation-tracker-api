import '../modules/users/users.graphql.js';
import '../modules/auth/auth.graphql.js';
import '../modules/jobs/jobs.graphql.js';
import '../modules/messages/messages.graphql.js';
import '../modules/reports/reports.graphql.js';
import '../modules/history/history.graphql.js';

import { builder } from './builder.js';

builder.queryField('health', (t) =>
  t.string({
    description: 'Liveness probe for the GraphQL layer.',
    resolve: () => 'ok',
  }),
);

export const schema = builder.toSchema();
