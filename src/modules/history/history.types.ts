import { z } from 'zod';

import {
  type HistoryKind,
  type JobHistoryRow,
  jobStatus,
  type RecordedChanges,
} from '../../db/schema/index.js';

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface HistoryEntry {
  id: string;
  jobId: string;
  seq: number;
  kind: HistoryKind;
  changes: FieldChange[];
  targetSeq: number | null;
  supersededAt: Date | null;
  actorId: string;
  createdAt: Date;
}

export function toHistoryEntry(row: JobHistoryRow): HistoryEntry {
  return {
    id: row.id,
    jobId: row.jobId,
    seq: row.seq,
    kind: row.kind,
    changes: Object.entries(row.changes).map(([field, change]) => ({
      field,
      before: change.before,
      after: change.after,
    })),
    targetSeq: row.targetSeq,
    supersededAt: row.supersededAt,
    actorId: row.actorId,
    createdAt: row.createdAt,
  };
}

export const UNDOABLE_KINDS: readonly HistoryKind[] = ['UPDATED', 'DELETED'];

export function isUndoableKind(kind: HistoryKind): boolean {
  return UNDOABLE_KINDS.includes(kind);
}

export interface HistoryPageQuery {
  afterSeq?: number;
  beforeSeq?: number;
  limit: number;
  inverted: boolean;
}

export class HistoryIntegrityError extends Error {
  constructor(message: string) {
    super(`job history integrity violated: ${message}`);
    this.name = 'HistoryIntegrityError';
  }
}

export const recordedLocationSchema = z.object({
  addressLine1: z.string(),
  addressLine2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
  country: z.string(),
});

export const recordedJobValueSchemas = {
  description: z.string(),
  status: z.enum(jobStatus.enumValues),
  costCents: z.number().int(),
  location: recordedLocationSchema,
  deletedAt: z.string().nullable(),
} as const;

export type UndoableField = keyof typeof recordedJobValueSchemas;

export function isUndoableField(field: string): field is UndoableField {
  return Object.hasOwn(recordedJobValueSchemas, field);
}

export function toRecordedValue(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

export function invertChanges(changes: RecordedChanges): RecordedChanges {
  return Object.fromEntries(
    Object.entries(changes).map(([field, change]) => [
      field,
      { before: change.after, after: change.before },
    ]),
  );
}

export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(toRecordedValue(value)));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, sortKeys(entry)]),
    );
  }
  return value ?? null;
}
