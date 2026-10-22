import { type Db, type DbExecutor, type Tx } from '../../db/client.js';
import { type JobRow, type NewJobRow } from '../../db/schema/index.js';
import { newId } from '../../shared/ids.js';
import {
  type JobHomeownerLink,
  type JobPatch,
  type JobsRepository,
  type JobVisibility,
} from './jobs.repository.js';

export class FakeJobsRepository implements JobsRepository {
  readonly rows = new Map<string, JobRow>();
  readonly links: Array<JobHomeownerLink & { addedBy: string; createdAt: Date }> = [];
  private clock = 0;

  constructor(rows: readonly JobRow[] = []) {
    for (const row of rows) this.rows.set(row.id, row);
  }

  insert(_db: DbExecutor, values: NewJobRow): Promise<JobRow> {
    const now = this.tick();
    const row: JobRow = {
      id: values.id ?? newId(),
      contractorId: values.contractorId,
      description: values.description,
      addressLine1: values.addressLine1,
      addressLine2: values.addressLine2 ?? null,
      city: values.city,
      state: values.state,
      postalCode: values.postalCode,
      country: values.country ?? 'US',
      status: values.status ?? 'PLANNING',
      costCents: values.costCents ?? 0,
      version: values.version ?? 1,
      historyCursor: values.historyCursor ?? 0,
      deletedAt: values.deletedAt ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  findById(
    _db: DbExecutor,
    id: string,
    { includeDeleted = false }: JobVisibility = {},
  ): Promise<JobRow | undefined> {
    const row = this.rows.get(id);
    return Promise.resolve(row && (includeDeleted || !row.deletedAt) ? row : undefined);
  }

  findManyByIds(_db: DbExecutor, ids: readonly string[]): Promise<JobRow[]> {
    return Promise.resolve(ids.flatMap((id) => this.rows.get(id) ?? []));
  }

  findByIdForUpdate(_tx: Tx, id: string): Promise<JobRow | undefined> {
    return Promise.resolve(this.rows.get(id));
  }

  listByContractor(
    _db: DbExecutor,
    contractorId: string,
    { includeDeleted = false }: JobVisibility = {},
  ): Promise<JobRow[]> {
    return Promise.resolve(
      this.sorted().filter(
        (row) => row.contractorId === contractorId && (includeDeleted || !row.deletedAt),
      ),
    );
  }

  listByHomeowner(_db: DbExecutor, homeownerId: string): Promise<JobRow[]> {
    const jobIds = new Set(
      this.links.filter((link) => link.homeownerId === homeownerId).map((link) => link.jobId),
    );
    return Promise.resolve(this.sorted().filter((row) => jobIds.has(row.id) && !row.deletedAt));
  }

  update(_db: DbExecutor, id: string, patch: JobPatch): Promise<JobRow> {
    const current = this.rows.get(id);
    if (!current) throw new Error(`fake repository: job ${id} does not exist`);
    const updated: JobRow = {
      ...current,
      ...patch,
      version: current.version + 1,
      updatedAt: this.tick(),
    };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  isHomeowner(_db: DbExecutor, jobId: string, userId: string): Promise<boolean> {
    return Promise.resolve(
      this.links.some((link) => link.jobId === jobId && link.homeownerId === userId),
    );
  }

  addHomeowner(_db: DbExecutor, link: JobHomeownerLink & { addedBy: string }): Promise<boolean> {
    const exists = this.links.some(
      (existing) => existing.jobId === link.jobId && existing.homeownerId === link.homeownerId,
    );
    if (exists) return Promise.resolve(false);
    this.links.push({ ...link, createdAt: this.tick() });
    return Promise.resolve(true);
  }

  removeHomeowner(_db: DbExecutor, link: JobHomeownerLink): Promise<boolean> {
    const index = this.links.findIndex(
      (existing) => existing.jobId === link.jobId && existing.homeownerId === link.homeownerId,
    );
    if (index === -1) return Promise.resolve(false);
    this.links.splice(index, 1);
    return Promise.resolve(true);
  }

  listHomeownerLinks(_db: DbExecutor, jobIds: readonly string[]): Promise<JobHomeownerLink[]> {
    return Promise.resolve(
      this.links
        .filter((link) => jobIds.includes(link.jobId))
        .map(({ jobId, homeownerId }) => ({ jobId, homeownerId })),
    );
  }

  private sorted(): JobRow[] {
    return [...this.rows.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
    );
  }

  private tick(): Date {
    this.clock += 1;
    return new Date(Date.UTC(2026, 0, 1, 0, 0, this.clock));
  }
}

export function fakeDb(): Db {
  return { transaction: (fn: (tx: Tx) => Promise<unknown>) => fn({} as Tx) } as unknown as Db;
}
