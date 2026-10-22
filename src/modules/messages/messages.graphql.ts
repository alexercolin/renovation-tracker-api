import { resolveCursorConnection } from '@pothos/plugin-relay';

import { builder } from '../../graphql/builder.js';
import { requireCurrentUser } from '../../graphql/context.js';
import {
  assertPageSize,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  encodeCursor,
  MAX_PAGE_SIZE,
} from '../../graphql/pagination.js';
import { JobRef } from '../jobs/jobs.graphql.js';
import { UserRef } from '../users/users.graphql.js';
import { type Message } from './messages.types.js';

export const MessageRef = builder.objectRef<Message>('Message').implement({
  description: 'One entry of the chat log between a contractor and the homeowners of a job.',
  fields: (t) => ({
    id: t.exposeID('id'),
    body: t.exposeString('body'),
    clientMessageId: t.exposeID('clientMessageId', { nullable: true }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    sender: t.field({
      type: UserRef,
      resolve: (message, _args, ctx) => ctx.loaders.userById.load(message.senderId),
    }),
    job: t.field({
      type: JobRef,
      resolve: (message, _args, ctx) => ctx.loaders.jobById.load(message.jobId),
    }),
  }),
});

builder.objectField(JobRef, 'messages', (t) =>
  t.connection(
    {
      type: MessageRef,
      description: 'Chat log of the job, oldest first. Paginate forward with first/after.',
      resolve: (job, args, ctx) => {
        assertPageSize(args);
        return resolveCursorConnection<Promise<Message[]>>(
          {
            args,
            defaultSize: DEFAULT_PAGE_SIZE,
            maxSize: MAX_PAGE_SIZE,
            toCursor: (message) => encodeCursor(message.id),
          },
          ({ before, after, limit, inverted }) =>
            ctx.services.messages.listJobMessages(job.id, {
              afterId: after === undefined ? undefined : decodeCursor(after),
              beforeId: before === undefined ? undefined : decodeCursor(before),
              limit,
              inverted,
            }),
        );
      },
    },
    { name: 'MessageConnection' },
    { name: 'MessageEdge' },
  ),
);

builder.mutationField('sendMessage', (t) =>
  t.field({
    type: MessageRef,
    description: 'Posts a message to a job the caller belongs to.',
    authScopes: { authenticated: true },
    args: {
      jobId: t.arg.id(),
      body: t.arg.string(),
      clientMessageId: t.arg.id({
        required: false,
        description:
          'Client-generated UUID. Resending with the same id returns the original message instead of creating a duplicate.',
      }),
    },
    resolve: (_root, args, ctx) => ctx.services.messages.sendMessage(requireCurrentUser(ctx), args),
  }),
);

builder.subscriptionField('messageAdded', (t) =>
  t.field({
    type: MessageRef,
    description: 'Fires for every new message on a job the caller belongs to.',
    authScopes: { authenticated: true },
    args: { jobId: t.arg.id() },
    subscribe: (_root, args, ctx) =>
      ctx.services.messages.subscribeToJob(requireCurrentUser(ctx), args.jobId),
    resolve: async (event, _args, ctx) => {
      const message = await ctx.services.messages.getMessageById(event.messageId);
      ctx.loaders.jobById.clear(message.jobId);
      return message;
    },
  }),
);
