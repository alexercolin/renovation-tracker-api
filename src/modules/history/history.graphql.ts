import { resolveCursorConnection } from '@pothos/plugin-relay';

import { historyKind } from '../../db/schema/index.js';
import { builder } from '../../graphql/builder.js';
import { requireCurrentUser } from '../../graphql/context.js';
import {
  assertPageSize,
  decodeSeqCursor,
  DEFAULT_PAGE_SIZE,
  encodeSeqCursor,
  MAX_PAGE_SIZE,
} from '../../graphql/pagination.js';
import { JobRef } from '../jobs/jobs.graphql.js';
import { UserRef } from '../users/users.graphql.js';
import { type FieldChange, type HistoryEntry } from './history.types.js';

export const HistoryKindEnum = builder.enumType('HistoryKind', {
  values: historyKind.enumValues,
});

const FieldChangeRef = builder.objectRef<FieldChange>('FieldChange').implement({
  description: 'One field touched by a history entry, with the value before and after.',
  fields: (t) => ({
    field: t.exposeString('field'),
    before: t.expose('before', { type: 'JSON', nullable: true }),
    after: t.expose('after', { type: 'JSON', nullable: true }),
  }),
});

export const HistoryEntryRef = builder.objectRef<HistoryEntry>('HistoryEntry').implement({
  description: 'An append-only record of something that happened to a job.',
  fields: (t) => ({
    id: t.exposeID('id'),
    seq: t.exposeInt('seq', { description: 'Position in the job timeline, starting at 1.' }),
    kind: t.expose('kind', { type: HistoryKindEnum }),
    changes: t.expose('changes', { type: [FieldChangeRef] }),
    targetSeq: t.exposeInt('targetSeq', {
      nullable: true,
      description: 'For UNDONE and REDONE: the seq of the entry that was undone or redone.',
    }),
    supersededAt: t.expose('supersededAt', {
      type: 'DateTime',
      nullable: true,
      description: 'Set when a new edit discarded this entry from the redo stack.',
    }),
    actor: t.field({
      type: UserRef,
      resolve: (entry, _args, ctx) => ctx.loaders.userById.load(entry.actorId),
    }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
  }),
});

builder.objectFields(JobRef, (t) => ({
  history: t.connection(
    {
      type: HistoryEntryRef,
      description: 'Every change to the job, oldest first, including undo and redo themselves.',
      resolve: (job, args, ctx) => {
        assertPageSize(args);
        return resolveCursorConnection<Promise<HistoryEntry[]>>(
          {
            args,
            defaultSize: DEFAULT_PAGE_SIZE,
            maxSize: MAX_PAGE_SIZE,
            toCursor: (entry) => encodeSeqCursor(entry.seq),
          },
          ({ before, after, limit, inverted }) =>
            ctx.services.history.listJobHistory(job.id, {
              afterSeq: after === undefined ? undefined : decodeSeqCursor(after),
              beforeSeq: before === undefined ? undefined : decodeSeqCursor(before),
              limit,
              inverted,
            }),
        );
      },
    },
    { name: 'HistoryConnection' },
    { name: 'HistoryEdge' },
  ),
  canUndo: t.boolean({
    description: 'True when undoJobChange would revert something.',
    resolve: (job) => job.historyCursor > 0,
  }),
  canRedo: t.boolean({
    description: 'True when redoJobChange would re-apply an undone change.',
    resolve: (job, _args, ctx) => ctx.loaders.canRedoByJobId.load(job.id),
  }),
}));

builder.mutationFields((t) => ({
  undoJobChange: t.field({
    type: JobRef,
    description: 'Reverts the most recent applied change to the job, including a deletion.',
    authScopes: { contractor: true },
    args: { jobId: t.arg.id(), expectedVersion: t.arg.int({ required: false }) },
    resolve: (_root, args, ctx) =>
      ctx.services.history.undo(requireCurrentUser(ctx), args.jobId, args.expectedVersion),
  }),
  redoJobChange: t.field({
    type: JobRef,
    description: 'Re-applies the most recently undone change, unless a newer edit discarded it.',
    authScopes: { contractor: true },
    args: { jobId: t.arg.id(), expectedVersion: t.arg.int({ required: false }) },
    resolve: (_root, args, ctx) =>
      ctx.services.history.redo(requireCurrentUser(ctx), args.jobId, args.expectedVersion),
  }),
}));
