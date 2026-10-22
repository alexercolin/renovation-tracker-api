import { builder } from '../../graphql/builder.js';
import { UserRef } from '../users/users.graphql.js';
import { type AuthPayload } from './auth.service.js';

const AuthPayloadRef = builder.objectRef<AuthPayload>('AuthPayload').implement({
  fields: (t) => ({
    token: t.exposeString('token', { description: 'Bearer token for the Authorization header.' }),
    user: t.expose('user', { type: UserRef }),
  }),
});

builder.mutationField('login', (t) =>
  t.field({
    type: AuthPayloadRef,
    description: 'Exchanges email and password for a JWT.',
    args: {
      email: t.arg.string({ required: true }),
      password: t.arg.string({ required: true }),
    },
    resolve: (_root, args, ctx) => ctx.services.auth.login(args),
  }),
);
