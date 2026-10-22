import { reportStatus } from '../../db/schema/index.js';
import { builder } from '../../graphql/builder.js';
import { requireCurrentUser } from '../../graphql/context.js';
import { JobRef } from '../jobs/jobs.graphql.js';
import { UserRef } from '../users/users.graphql.js';
import { type Report } from './reports.types.js';

export const ReportStatusEnum = builder.enumType('ReportStatus', {
  values: reportStatus.enumValues,
});

export const ReportRef = builder.objectRef<Report>('Report').implement({
  description: 'A PDF export of a job, generated asynchronously by the worker.',
  fields: (t) => ({
    id: t.exposeID('id'),
    status: t.expose('status', { type: ReportStatusEnum }),
    job: t.field({
      type: JobRef,
      resolve: (report, _args, ctx) => ctx.loaders.jobById.load(report.jobId),
    }),
    requestedBy: t.field({
      type: UserRef,
      resolve: (report, _args, ctx) => ctx.loaders.userById.load(report.requestedBy),
    }),
    attempts: t.exposeInt('attempts'),
    error: t.exposeString('error', {
      nullable: true,
      description: 'Last failure message, kept even after a successful retry resets the status.',
    }),
    downloadUrl: t.string({
      nullable: true,
      description: 'Presigned URL valid for 15 minutes. Present only while status is COMPLETED.',
      resolve: (report, _args, ctx) => ctx.services.reports.downloadUrl(report),
    }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    startedAt: t.expose('startedAt', { type: 'DateTime', nullable: true }),
    completedAt: t.expose('completedAt', { type: 'DateTime', nullable: true }),
  }),
});

builder.queryField('report', (t) =>
  t.field({
    type: ReportRef,
    authScopes: { contractor: true },
    args: { id: t.arg.id() },
    resolve: (_root, args, ctx) => ctx.services.reports.getReport(requireCurrentUser(ctx), args.id),
  }),
);

builder.mutationField('requestReport', (t) =>
  t.field({
    type: ReportRef,
    description:
      'Queues a PDF report for one of your jobs. Poll report(id) until status is COMPLETED, then follow downloadUrl.',
    authScopes: { contractor: true },
    args: { jobId: t.arg.id() },
    resolve: (_root, args, ctx) =>
      ctx.services.reports.requestReport(requireCurrentUser(ctx), args.jobId),
  }),
);
