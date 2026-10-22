import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { type DbExecutor, type Tx } from '../../db/client.js';
import { type JobRow, jobHomeowners, jobs, type NewJobRow } from '../../db/schema/index.js';

export interface JobVisibility {
  includeDeleted?: boolean;
}

export type JobPatch = Partial<
  Pick<
    NewJobRow,
    | 'description'
    | 'addressLine1'
    | 'addressLine2'
    | 'city'
    | 'state'
    | 'postalCode'
    | 'country'
    | 'status'
    | 'costCents'
    | 'deletedAt'
  >
>;

export interface JobHomeownerLink {
  jobId: string;
  homeownerId: string;
}

export class JobsRepository {
  async insert(db: DbExecutor, values: NewJobRow): Promise<JobRow> {
    const [row] = await db.insert(jobs).values(values).returning();
    return row!;
  }

  async findById(
    db: DbExecutor,
    id: string,
    { includeDeleted = false }: JobVisibility = {},
  ): Promise<JobRow | undefined> {
    const [row] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, id), includeDeleted ? undefined : isNull(jobs.deletedAt)))
      .limit(1);
    return row;
  }

  async findByIdForUpdate(tx: Tx, id: string): Promise<JobRow | undefined> {
    const [row] = await tx.select().from(jobs).where(eq(jobs.id, id)).limit(1).for('update');
    return row;
  }

  async listByContractor(
    db: DbExecutor,
    contractorId: string,
    { includeDeleted = false }: JobVisibility = {},
  ): Promise<JobRow[]> {
    return db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.contractorId, contractorId),
          includeDeleted ? undefined : isNull(jobs.deletedAt),
        ),
      )
      .orderBy(desc(jobs.createdAt), desc(jobs.id));
  }

  async listByHomeowner(db: DbExecutor, homeownerId: string): Promise<JobRow[]> {
    const rows = await db
      .select({ job: jobs })
      .from(jobHomeowners)
      .innerJoin(jobs, eq(jobs.id, jobHomeowners.jobId))
      .where(and(eq(jobHomeowners.homeownerId, homeownerId), isNull(jobs.deletedAt)))
      .orderBy(desc(jobs.createdAt), desc(jobs.id));
    return rows.map((row) => row.job);
  }

  async update(db: DbExecutor, id: string, patch: JobPatch): Promise<JobRow> {
    const [row] = await db
      .update(jobs)
      .set({ ...patch, version: sql`${jobs.version} + 1`, updatedAt: new Date() })
      .where(eq(jobs.id, id))
      .returning();
    return row!;
  }

  async isHomeowner(db: DbExecutor, jobId: string, userId: string): Promise<boolean> {
    const [row] = await db
      .select({ jobId: jobHomeowners.jobId })
      .from(jobHomeowners)
      .where(and(eq(jobHomeowners.jobId, jobId), eq(jobHomeowners.homeownerId, userId)))
      .limit(1);
    return row !== undefined;
  }

  async addHomeowner(
    db: DbExecutor,
    link: JobHomeownerLink & { addedBy: string },
  ): Promise<boolean> {
    const inserted = await db
      .insert(jobHomeowners)
      .values(link)
      .onConflictDoNothing()
      .returning({ jobId: jobHomeowners.jobId });
    return inserted.length > 0;
  }

  async removeHomeowner(db: DbExecutor, link: JobHomeownerLink): Promise<boolean> {
    const removed = await db
      .delete(jobHomeowners)
      .where(
        and(eq(jobHomeowners.jobId, link.jobId), eq(jobHomeowners.homeownerId, link.homeownerId)),
      )
      .returning({ jobId: jobHomeowners.jobId });
    return removed.length > 0;
  }

  async listHomeownerLinks(db: DbExecutor, jobIds: readonly string[]): Promise<JobHomeownerLink[]> {
    if (jobIds.length === 0) return [];
    return db
      .select({ jobId: jobHomeowners.jobId, homeownerId: jobHomeowners.homeownerId })
      .from(jobHomeowners)
      .where(inArray(jobHomeowners.jobId, [...jobIds]))
      .orderBy(jobHomeowners.createdAt);
  }
}
