import { type DbExecutor } from '../../db/client.js';
import { type NewReportRow, type ReportRow } from '../../db/schema/index.js';
import { newId } from '../../shared/ids.js';
import { type ReportPatch, type ReportsRepository } from './reports.repository.js';

export class FakeReportsRepository implements ReportsRepository {
  readonly rows = new Map<string, ReportRow>();

  insert(_db: DbExecutor, values: NewReportRow): Promise<ReportRow> {
    const row: ReportRow = {
      id: values.id ?? newId(),
      jobId: values.jobId,
      requestedBy: values.requestedBy,
      status: values.status ?? 'PENDING',
      s3Key: values.s3Key ?? null,
      error: values.error ?? null,
      attempts: values.attempts ?? 0,
      createdAt: new Date(),
      startedAt: values.startedAt ?? null,
      completedAt: values.completedAt ?? null,
    };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  findById(_db: DbExecutor, id: string): Promise<ReportRow | undefined> {
    return Promise.resolve(this.rows.get(id));
  }

  update(_db: DbExecutor, id: string, patch: ReportPatch): Promise<ReportRow> {
    const updated = { ...this.require(id), ...patch };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  startAttempt(_db: DbExecutor, id: string): Promise<ReportRow> {
    const current = this.require(id);
    const updated: ReportRow = {
      ...current,
      status: 'PROCESSING',
      attempts: current.attempts + 1,
      startedAt: new Date(),
      error: null,
    };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  private require(id: string): ReportRow {
    const row = this.rows.get(id);
    if (!row) throw new Error(`fake repository: report ${id} does not exist`);
    return row;
  }
}
