import { and, asc, desc, eq, gt, inArray, isNull, lt, max, min, sql } from 'drizzle-orm';

import { type DbExecutor } from '../../db/client.js';
import {
  type HistoryKind,
  jobHistory,
  type JobHistoryRow,
  jobs,
  type NewJobHistoryRow,
} from '../../db/schema/index.js';
import { type HistoryPageQuery, UNDOABLE_KINDS } from './history.types.js';

export type NewHistoryEntry = Omit<NewJobHistoryRow, 'seq'>;

const undoableKinds = [...UNDOABLE_KINDS] as HistoryKind[];

export class HistoryRepository {
  async insert(db: DbExecutor, values: NewHistoryEntry): Promise<JobHistoryRow> {
    const [row] = await db
      .insert(jobHistory)
      .values({
        ...values,
        seq: sql`coalesce((select max(${jobHistory.seq}) from ${jobHistory} where ${jobHistory.jobId} = ${values.jobId}), 0) + 1`,
      })
      .returning();
    return row!;
  }

  async findBySeq(db: DbExecutor, jobId: string, seq: number): Promise<JobHistoryRow | undefined> {
    const [row] = await db
      .select()
      .from(jobHistory)
      .where(and(eq(jobHistory.jobId, jobId), eq(jobHistory.seq, seq)))
      .limit(1);
    return row;
  }

  async latestUndoableSeqBelow(db: DbExecutor, jobId: string, seq: number): Promise<number> {
    const [row] = await db
      .select({ value: max(jobHistory.seq) })
      .from(jobHistory)
      .where(
        and(
          eq(jobHistory.jobId, jobId),
          lt(jobHistory.seq, seq),
          inArray(jobHistory.kind, undoableKinds),
          isNull(jobHistory.supersededAt),
        ),
      );
    return row?.value ?? 0;
  }

  async nextRedoableSeq(
    db: DbExecutor,
    jobId: string,
    cursor: number,
  ): Promise<number | undefined> {
    const [row] = await db
      .select({ value: min(jobHistory.seq) })
      .from(jobHistory)
      .where(
        and(
          eq(jobHistory.jobId, jobId),
          gt(jobHistory.seq, cursor),
          inArray(jobHistory.kind, undoableKinds),
          isNull(jobHistory.supersededAt),
        ),
      );
    return row?.value ?? undefined;
  }

  async supersedeAfter(db: DbExecutor, jobId: string, cursor: number): Promise<number> {
    const superseded = await db
      .update(jobHistory)
      .set({ supersededAt: new Date() })
      .where(
        and(
          eq(jobHistory.jobId, jobId),
          gt(jobHistory.seq, cursor),
          inArray(jobHistory.kind, undoableKinds),
          isNull(jobHistory.supersededAt),
        ),
      )
      .returning({ seq: jobHistory.seq });
    return superseded.length;
  }

  async listPage(
    db: DbExecutor,
    jobId: string,
    { afterSeq, beforeSeq, limit, inverted }: HistoryPageQuery,
  ): Promise<JobHistoryRow[]> {
    const conditions = [eq(jobHistory.jobId, jobId)];
    if (afterSeq !== undefined) conditions.push(gt(jobHistory.seq, afterSeq));
    if (beforeSeq !== undefined) conditions.push(lt(jobHistory.seq, beforeSeq));

    return db
      .select()
      .from(jobHistory)
      .where(and(...conditions))
      .orderBy(inverted ? desc(jobHistory.seq) : asc(jobHistory.seq))
      .limit(limit);
  }

  async jobIdsWithRedo(db: DbExecutor, jobIds: readonly string[]): Promise<Set<string>> {
    if (jobIds.length === 0) return new Set();
    const rows = await db
      .selectDistinct({ jobId: jobHistory.jobId })
      .from(jobHistory)
      .innerJoin(jobs, eq(jobs.id, jobHistory.jobId))
      .where(
        and(
          inArray(jobHistory.jobId, [...jobIds]),
          gt(jobHistory.seq, jobs.historyCursor),
          inArray(jobHistory.kind, undoableKinds),
          isNull(jobHistory.supersededAt),
        ),
      );
    return new Set(rows.map((row) => row.jobId));
  }
}
