import { type DbExecutor } from '../../db/client.js';
import { type JobHistoryRow } from '../../db/schema/index.js';
import { newId } from '../../shared/ids.js';
import { type FakeJobsRepository } from '../jobs/jobs.repository.fake.js';
import { type HistoryRepository, type NewHistoryEntry } from './history.repository.js';
import { type HistoryPageQuery, isUndoableKind } from './history.types.js';

export class FakeHistoryRepository implements HistoryRepository {
  readonly rows: JobHistoryRow[] = [];
  private clock = 0;

  constructor(private readonly jobsRepository: FakeJobsRepository) {}

  insert(_db: DbExecutor, values: NewHistoryEntry): Promise<JobHistoryRow> {
    this.clock += 1;
    const seq = Math.max(0, ...this.forJob(values.jobId).map((row) => row.seq)) + 1;
    const row: JobHistoryRow = {
      id: values.id ?? newId(),
      jobId: values.jobId,
      seq,
      kind: values.kind,
      changes: values.changes,
      targetSeq: values.targetSeq ?? null,
      supersededAt: values.supersededAt ?? null,
      actorId: values.actorId,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, this.clock)),
    };
    this.rows.push(row);
    return Promise.resolve(row);
  }

  findBySeq(_db: DbExecutor, jobId: string, seq: number): Promise<JobHistoryRow | undefined> {
    return Promise.resolve(this.forJob(jobId).find((row) => row.seq === seq));
  }

  latestUndoableSeqBelow(_db: DbExecutor, jobId: string, seq: number): Promise<number> {
    const candidates = this.undoable(jobId).filter((row) => row.seq < seq);
    return Promise.resolve(Math.max(0, ...candidates.map((row) => row.seq)));
  }

  nextRedoableSeq(_db: DbExecutor, jobId: string, cursor: number): Promise<number | undefined> {
    const candidates = this.undoable(jobId).filter((row) => row.seq > cursor);
    return Promise.resolve(
      candidates.length === 0 ? undefined : Math.min(...candidates.map((row) => row.seq)),
    );
  }

  supersedeAfter(_db: DbExecutor, jobId: string, cursor: number): Promise<number> {
    const targets = this.undoable(jobId).filter((row) => row.seq > cursor);
    for (const row of targets) row.supersededAt = new Date();
    return Promise.resolve(targets.length);
  }

  listPage(
    _db: DbExecutor,
    jobId: string,
    { afterSeq, beforeSeq, limit, inverted }: HistoryPageQuery,
  ): Promise<JobHistoryRow[]> {
    let rows = this.forJob(jobId).sort((a, b) => a.seq - b.seq);
    if (afterSeq !== undefined) rows = rows.filter((row) => row.seq > afterSeq);
    if (beforeSeq !== undefined) rows = rows.filter((row) => row.seq < beforeSeq);
    if (inverted) rows = [...rows].reverse();
    return Promise.resolve(rows.slice(0, limit));
  }

  jobIdsWithRedo(_db: DbExecutor, jobIds: readonly string[]): Promise<Set<string>> {
    const result = new Set<string>();
    for (const jobId of jobIds) {
      const cursor = this.jobsRepository.rows.get(jobId)?.historyCursor ?? 0;
      if (this.undoable(jobId).some((row) => row.seq > cursor)) result.add(jobId);
    }
    return Promise.resolve(result);
  }

  private forJob(jobId: string): JobHistoryRow[] {
    return this.rows.filter((row) => row.jobId === jobId);
  }

  private undoable(jobId: string): JobHistoryRow[] {
    return this.forJob(jobId).filter(
      (row) => isUndoableKind(row.kind) && row.supersededAt === null,
    );
  }
}
