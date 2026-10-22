import { eq, sql } from 'drizzle-orm';

import { type DbExecutor } from '../../db/client.js';
import { type NewReportRow, type ReportRow, reports } from '../../db/schema/index.js';

export type ReportPatch = Partial<
  Pick<NewReportRow, 'status' | 's3Key' | 'error' | 'startedAt' | 'completedAt'>
>;

export class ReportsRepository {
  async insert(db: DbExecutor, values: NewReportRow): Promise<ReportRow> {
    const [row] = await db.insert(reports).values(values).returning();
    return row!;
  }

  async findById(db: DbExecutor, id: string): Promise<ReportRow | undefined> {
    const [row] = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
    return row;
  }

  async update(db: DbExecutor, id: string, patch: ReportPatch): Promise<ReportRow> {
    const [row] = await db.update(reports).set(patch).where(eq(reports.id, id)).returning();
    return row!;
  }

  async startAttempt(db: DbExecutor, id: string): Promise<ReportRow> {
    const [row] = await db
      .update(reports)
      .set({
        status: 'PROCESSING',
        attempts: sql`${reports.attempts} + 1`,
        startedAt: new Date(),
        error: null,
      })
      .where(eq(reports.id, id))
      .returning();
    return row!;
  }
}
