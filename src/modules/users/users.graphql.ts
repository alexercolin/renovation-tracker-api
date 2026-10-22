import { userRole } from '../../db/schema/index.js';
import { builder } from '../../graphql/builder.js';
import { requireCurrentUser } from '../../graphql/context.js';
import { type User } from './users.service.js';

export const RoleEnum = builder.enumType('Role', {
  values: userRole.enumValues,
});

export const UserRef = builder.objectRef<User>('User').implement({
  description: 'A contractor or a homeowner.',
  fields: (t) => ({
    id: t.exposeID('id'),
    email: t.exposeString('email'),
    name: t.exposeString('name'),
    role: t.expose('role', { type: RoleEnum }),
  }),
});

builder.queryField('me', (t) =>
  t.field({
    type: UserRef,
    description: 'The authenticated user.',
    authScopes: { authenticated: true },
    resolve: (_root, _args, ctx) => ctx.services.users.getById(requireCurrentUser(ctx).id),
  }),
);
