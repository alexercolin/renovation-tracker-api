import { type Db, type Tx } from '../../db/client.js';
import {
  type HistoryKind,
  type JobHistoryRow,
  type JobRow,
  type RecordedChanges,
} from '../../db/schema/index.js';
import { type Actor } from '../../shared/actor.js';
import { ConflictError } from '../../shared/errors.js';
import { parseId } from '../../shared/ids.js';
import { type JobChanges } from '../jobs/jobs.diff.js';
import { assertExpectedVersion, lockOwnedJob } from '../jobs/jobs.guards.js';
import { type JobPatch, type JobsRepository } from '../jobs/jobs.repository.js';
import { type Job, locationToColumns, toJob } from '../jobs/jobs.types.js';
import { type User } from '../users/users.service.js';
import { type HistoryRepository } from './history.repository.js';
import {
  canonical,
  type HistoryEntry,
  HistoryIntegrityError,
  type HistoryPageQuery,
  invertChanges,
  isUndoableField,
  isUndoableKind,
  recordedJobValueSchemas,
  toHistoryEntry,
  toRecordedValue,
  type UndoableField,
} from './history.types.js';

type Direction = 'undo' | 'redo';

export class HistoryService {
  constructor(
    private readonly db: Db,
    private readonly historyRepository: HistoryRepository,
    private readonly jobsRepository: JobsRepository,
  ) {}

  async recordCreated(tx: Tx, job: Job, actorId: string): Promise<void> {
    const changes: RecordedChanges = {
      description: { before: null, after: job.description },
      location: { before: null, after: job.location },
      status: { before: null, after: job.status },
      costCents: { before: null, after: job.costCents },
    };
    await this.historyRepository.insert(tx, { jobId: job.id, kind: 'CREATED', changes, actorId });
  }

  recordUpdate(tx: Tx, row: JobRow, changes: JobChanges, actorId: string): Promise<number> {
    const recorded: RecordedChanges = Object.fromEntries(
      Object.entries(changes).map(([field, change]) => [
        field,
        { before: toRecordedValue(change.before), after: toRecordedValue(change.after) },
      ]),
    );
    return this.recordUndoable(tx, row, 'UPDATED', recorded, actorId);
  }

  recordDeleted(tx: Tx, row: JobRow, deletedAt: Date, actorId: string): Promise<number> {
    return this.recordUndoable(
      tx,
      row,
      'DELETED',
      { deletedAt: { before: null, after: deletedAt.toISOString() } },
      actorId,
    );
  }

  async recordHomeownerChange(
    tx: Tx,
    jobId: string,
    kind: Extract<HistoryKind, 'HOMEOWNER_ADDED' | 'HOMEOWNER_REMOVED'>,
    homeowner: User,
    actorId: string,
  ): Promise<void> {
    const person = { id: homeowner.id, name: homeowner.name, email: homeowner.email };
    const changes: RecordedChanges =
      kind === 'HOMEOWNER_ADDED'
        ? { homeowner: { before: null, after: person } }
        : { homeowner: { before: person, after: null } };
    await this.historyRepository.insert(tx, { jobId, kind, changes, actorId });
  }

  undo(actor: Actor, id: string, expectedVersion?: number | null): Promise<Job> {
    return this.step(actor, parseId(id, 'jobId'), expectedVersion ?? undefined, 'undo');
  }

  redo(actor: Actor, id: string, expectedVersion?: number | null): Promise<Job> {
    return this.step(actor, parseId(id, 'jobId'), expectedVersion ?? undefined, 'redo');
  }

  async listJobHistory(jobId: string, page: HistoryPageQuery): Promise<HistoryEntry[]> {
    const rows = await this.historyRepository.listPage(this.db, jobId, page);
    return rows.map(toHistoryEntry);
  }

  jobIdsWithRedo(jobIds: readonly string[]): Promise<Set<string>> {
    return this.historyRepository.jobIdsWithRedo(this.db, jobIds);
  }

  private async recordUndoable(
    tx: Tx,
    row: JobRow,
    kind: Extract<HistoryKind, 'UPDATED' | 'DELETED'>,
    changes: RecordedChanges,
    actorId: string,
  ): Promise<number> {
    await this.historyRepository.supersedeAfter(tx, row.id, row.historyCursor);
    const entry = await this.historyRepository.insert(tx, {
      jobId: row.id,
      kind,
      changes,
      actorId,
    });
    return entry.seq;
  }

  private step(
    actor: Actor,
    jobId: string,
    expectedVersion: number | undefined,
    direction: Direction,
  ): Promise<Job> {
    return this.db.transaction(async (tx) => {
      const row = await lockOwnedJob(tx, this.jobsRepository, actor, jobId);
      assertExpectedVersion(row, expectedVersion);

      const target = await this.findTarget(tx, row, direction);
      const patch = applyChanges(row, target.changes, direction);
      const cursor =
        direction === 'undo'
          ? await this.historyRepository.latestUndoableSeqBelow(tx, row.id, target.seq)
          : target.seq;

      const updated = await this.jobsRepository.update(tx, row.id, {
        ...patch,
        historyCursor: cursor,
      });
      await this.historyRepository.insert(tx, {
        jobId: row.id,
        kind: direction === 'undo' ? 'UNDONE' : 'REDONE',
        changes: direction === 'undo' ? invertChanges(target.changes) : target.changes,
        targetSeq: target.seq,
        actorId: actor.id,
      });
      return toJob(updated);
    });
  }

  private async findTarget(tx: Tx, row: JobRow, direction: Direction): Promise<JobHistoryRow> {
    const seq =
      direction === 'undo'
        ? row.historyCursor
        : await this.historyRepository.nextRedoableSeq(tx, row.id, row.historyCursor);
    if (!seq) {
      throw new ConflictError(direction === 'undo' ? 'Nothing to undo' : 'Nothing to redo', {
        jobId: row.id,
      });
    }

    const target = await this.historyRepository.findBySeq(tx, row.id, seq);
    if (!target || !isUndoableKind(target.kind) || target.supersededAt !== null) {
      throw new HistoryIntegrityError(
        `entry ${seq} of job ${row.id} is not an applicable ${direction} target`,
      );
    }
    return target;
  }
}

function applyChanges(row: JobRow, changes: RecordedChanges, direction: Direction): JobPatch {
  const job = toJob(row);
  const patch: JobPatch = {};

  for (const [field, change] of Object.entries(changes)) {
    if (!isUndoableField(field)) {
      throw new HistoryIntegrityError(`field ${field} of job ${row.id} cannot be restored`);
    }
    const expected = direction === 'undo' ? change.after : change.before;
    const target = direction === 'undo' ? change.before : change.after;
    const actual = currentValue(job, field);
    if (canonical(actual) !== canonical(expected)) {
      throw new HistoryIntegrityError(
        `field ${field} of job ${row.id} is ${canonical(actual)}, expected ${canonical(expected)}`,
      );
    }
    Object.assign(patch, patchFor(row.id, field, target));
  }

  return patch;
}

function currentValue(job: Job, field: UndoableField): unknown {
  switch (field) {
    case 'deletedAt':
      return job.deletedAt?.toISOString() ?? null;
    default:
      return job[field];
  }
}

function patchFor(jobId: string, field: UndoableField, value: unknown): JobPatch {
  const parsed = recordedJobValueSchemas[field].safeParse(value);
  if (!parsed.success) {
    throw new HistoryIntegrityError(`recorded value for ${field} of job ${jobId} is malformed`);
  }
  switch (field) {
    case 'description':
      return { description: parsed.data as string };
    case 'status':
      return { status: parsed.data as Job['status'] };
    case 'costCents':
      return { costCents: parsed.data as number };
    case 'location':
      return locationToColumns(parsed.data as Job['location']);
    case 'deletedAt': {
      const iso = parsed.data as string | null;
      return { deletedAt: iso === null ? null : new Date(iso) };
    }
  }
}
