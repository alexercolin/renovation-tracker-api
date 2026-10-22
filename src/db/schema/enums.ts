import { pgEnum } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['CONTRACTOR', 'HOMEOWNER']);
export const jobStatus = pgEnum('job_status', ['PLANNING', 'IN_PROGRESS', 'COMPLETED', 'CANCELED']);
export const reportStatus = pgEnum('report_status', [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
]);
export const historyKind = pgEnum('history_kind', [
  'CREATED',
  'UPDATED',
  'DELETED',
  'UNDONE',
  'REDONE',
  'HOMEOWNER_ADDED',
  'HOMEOWNER_REMOVED',
]);

export type UserRole = (typeof userRole.enumValues)[number];
export type JobStatus = (typeof jobStatus.enumValues)[number];
export type ReportStatus = (typeof reportStatus.enumValues)[number];
export type HistoryKind = (typeof historyKind.enumValues)[number];
