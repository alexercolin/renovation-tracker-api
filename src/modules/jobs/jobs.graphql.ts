import { jobStatus } from '../../db/schema/index.js';
import { builder } from '../../graphql/builder.js';
import { requireCurrentUser } from '../../graphql/context.js';
import { UserRef } from '../users/users.graphql.js';
import { type Job, type Location } from './jobs.types.js';

export const JobStatusEnum = builder.enumType('JobStatus', {
  values: jobStatus.enumValues,
});

export const LocationRef = builder.objectRef<Location>('Location').implement({
  fields: (t) => ({
    addressLine1: t.exposeString('addressLine1'),
    addressLine2: t.exposeString('addressLine2', { nullable: true }),
    city: t.exposeString('city'),
    state: t.exposeString('state'),
    postalCode: t.exposeString('postalCode'),
    country: t.exposeString('country'),
  }),
});

export const JobRef = builder.objectRef<Job>('Job').implement({
  description: 'A renovation job owned by one contractor and shared with its homeowners.',
  fields: (t) => ({
    id: t.exposeID('id'),
    description: t.exposeString('description'),
    location: t.expose('location', { type: LocationRef }),
    status: t.expose('status', { type: JobStatusEnum }),
    costCents: t.exposeInt('costCents', { description: 'Cost in USD cents.' }),
    version: t.exposeInt('version', {
      description:
        'Increments on every change. Send it back as expectedVersion to detect lost updates.',
    }),
    contractor: t.field({
      type: UserRef,
      resolve: (job, _args, ctx) => ctx.loaders.userById.load(job.contractorId),
    }),
    homeowners: t.field({
      type: [UserRef],
      resolve: (job, _args, ctx) => ctx.loaders.homeownersByJobId.load(job.id),
    }),
    deletedAt: t.expose('deletedAt', { type: 'DateTime', nullable: true }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
  }),
});

const LocationInput = builder.inputType('LocationInput', {
  fields: (t) => ({
    addressLine1: t.string(),
    addressLine2: t.string({ required: false }),
    city: t.string(),
    state: t.string(),
    postalCode: t.string(),
    country: t.string({ required: false, description: 'ISO 3166-1 alpha-2. Defaults to US.' }),
  }),
});

const CreateJobInput = builder.inputType('CreateJobInput', {
  fields: (t) => ({
    description: t.string(),
    location: t.field({ type: LocationInput }),
    status: t.field({ type: JobStatusEnum, required: false }),
    costCents: t.int({ required: false }),
  }),
});

const UpdateJobInput = builder.inputType('UpdateJobInput', {
  fields: (t) => ({
    description: t.string({ required: false }),
    location: t.field({ type: LocationInput, required: false }),
    status: t.field({ type: JobStatusEnum, required: false }),
    costCents: t.int({ required: false }),
    expectedVersion: t.int({
      required: false,
      description: 'Fails with CONFLICT when the job changed since this version was read.',
    }),
  }),
});

builder.queryFields((t) => ({
  jobs: t.field({
    type: [JobRef],
    description:
      'Jobs the caller can see: owned jobs for a contractor, memberships for a homeowner.',
    authScopes: { authenticated: true },
    args: {
      includeDeleted: t.arg.boolean({
        required: false,
        defaultValue: false,
        description: 'Contractors only: also return soft-deleted jobs.',
      }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.jobs.listJobs(requireCurrentUser(ctx), {
        includeDeleted: args.includeDeleted ?? false,
      }),
  }),
  job: t.field({
    type: JobRef,
    authScopes: { authenticated: true },
    args: { id: t.arg.id() },
    resolve: (_root, args, ctx) => ctx.services.jobs.getJob(requireCurrentUser(ctx), args.id),
  }),
}));

builder.mutationFields((t) => ({
  createJob: t.field({
    type: JobRef,
    authScopes: { contractor: true },
    args: { input: t.arg({ type: CreateJobInput }) },
    resolve: (_root, args, ctx) => ctx.services.jobs.createJob(requireCurrentUser(ctx), args.input),
  }),
  updateJob: t.field({
    type: JobRef,
    authScopes: { contractor: true },
    args: { id: t.arg.id(), input: t.arg({ type: UpdateJobInput }) },
    resolve: (_root, args, ctx) =>
      ctx.services.jobs.updateJob(requireCurrentUser(ctx), args.id, args.input),
  }),
  deleteJob: t.field({
    type: JobRef,
    description: 'Soft-deletes the job and returns it with deletedAt set.',
    authScopes: { contractor: true },
    args: { id: t.arg.id(), expectedVersion: t.arg.int({ required: false }) },
    resolve: (_root, args, ctx) =>
      ctx.services.jobs.deleteJob(requireCurrentUser(ctx), args.id, args.expectedVersion),
  }),
  addHomeowner: t.field({
    type: JobRef,
    description: 'Adds a homeowner account by email. Adding an existing member is a no-op.',
    authScopes: { contractor: true },
    args: { jobId: t.arg.id(), email: t.arg.string() },
    resolve: (_root, args, ctx) =>
      ctx.services.jobs.addHomeowner(requireCurrentUser(ctx), args.jobId, args.email),
  }),
  removeHomeowner: t.field({
    type: JobRef,
    description: 'Removes a homeowner from the job. Removing a non-member is a no-op.',
    authScopes: { contractor: true },
    args: { jobId: t.arg.id(), homeownerId: t.arg.id() },
    resolve: (_root, args, ctx) =>
      ctx.services.jobs.removeHomeowner(requireCurrentUser(ctx), args.jobId, args.homeownerId),
  }),
}));
