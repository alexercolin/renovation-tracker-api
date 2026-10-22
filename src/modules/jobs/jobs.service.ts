import { type Db } from '../../db/client.js';
import { type JobRow } from '../../db/schema/index.js';
import { type Actor } from '../../shared/actor.js';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { parseId } from '../../shared/ids.js';
import { type HistoryService } from '../history/history.service.js';
import { type UsersRepository } from '../users/users.repository.js';
import { toUser, type User } from '../users/users.service.js';
import { diffJobFields, hasChanges, type JobChanges } from './jobs.diff.js';
import { assertExpectedVersion, assertNotDeleted, lockOwnedJob } from './jobs.guards.js';
import { type JobPatch, type JobsRepository } from './jobs.repository.js';
import {
  createJobInputSchema,
  type Job,
  locationToColumns,
  toJob,
  updateJobInputSchema,
} from './jobs.types.js';

export interface ListJobsOptions {
  includeDeleted?: boolean;
}

export class JobsService {
  constructor(
    private readonly db: Db,
    private readonly jobsRepository: JobsRepository,
    private readonly usersRepository: UsersRepository,
    private readonly historyService: HistoryService,
  ) {}

  async createJob(actor: Actor, input: unknown): Promise<Job> {
    const parsed = createJobInputSchema.safeParse(input);
    if (!parsed.success) throw ValidationError.fromZod(parsed.error);
    const { location, ...fields } = parsed.data;

    return this.db.transaction(async (tx) => {
      const row = await this.jobsRepository.insert(tx, {
        ...fields,
        ...locationToColumns(location),
        contractorId: actor.id,
      });
      const job = toJob(row);
      await this.historyService.recordCreated(tx, job, actor.id);
      return job;
    });
  }

  async getJob(actor: Actor, id: string): Promise<Job> {
    return toJob(await this.loadVisibleJob(actor, parseId(id)));
  }

  async listJobs(actor: Actor, { includeDeleted = false }: ListJobsOptions = {}): Promise<Job[]> {
    const rows =
      actor.role === 'CONTRACTOR'
        ? await this.jobsRepository.listByContractor(this.db, actor.id, { includeDeleted })
        : await this.jobsRepository.listByHomeowner(this.db, actor.id);
    return rows.map(toJob);
  }

  async updateJob(actor: Actor, id: string, input: unknown): Promise<Job> {
    const jobId = parseId(id);
    const parsed = updateJobInputSchema.safeParse(input);
    if (!parsed.success) throw ValidationError.fromZod(parsed.error);
    const { expectedVersion, ...desired } = parsed.data;

    return this.db.transaction(async (tx) => {
      const row = await lockOwnedJob(tx, this.jobsRepository, actor, jobId);
      assertNotDeleted(row);
      assertExpectedVersion(row, expectedVersion);

      const current = toJob(row);
      const changes = diffJobFields(current, desired);
      if (!hasChanges(changes)) return current;

      const cursor = await this.historyService.recordUpdate(tx, row, changes, actor.id);
      const updated = await this.jobsRepository.update(tx, row.id, {
        ...changesToPatch(changes),
        historyCursor: cursor,
      });
      return toJob(updated);
    });
  }

  async deleteJob(actor: Actor, id: string, expectedVersion?: number | null): Promise<Job> {
    const jobId = parseId(id);

    return this.db.transaction(async (tx) => {
      const row = await lockOwnedJob(tx, this.jobsRepository, actor, jobId);
      if (row.deletedAt) throw new ConflictError('Job is already deleted', { id: jobId });
      assertExpectedVersion(row, expectedVersion ?? undefined);

      const deletedAt = new Date();
      const cursor = await this.historyService.recordDeleted(tx, row, deletedAt, actor.id);
      const deleted = await this.jobsRepository.update(tx, row.id, {
        deletedAt,
        historyCursor: cursor,
      });
      return toJob(deleted);
    });
  }

  async addHomeowner(actor: Actor, id: string, email: string): Promise<Job> {
    const jobId = parseId(id, 'jobId');
    const normalizedEmail = email.trim().toLowerCase();

    return this.db.transaction(async (tx) => {
      const row = await lockOwnedJob(tx, this.jobsRepository, actor, jobId);
      assertNotDeleted(row);

      const homeowner = await this.usersRepository.findByEmail(tx, normalizedEmail);
      if (!homeowner) throw new NotFoundError('Homeowner', normalizedEmail);
      if (homeowner.role !== 'HOMEOWNER') {
        throw new ValidationError('User is not a homeowner', [
          { path: 'email', message: 'Only homeowner accounts can be added to a job' },
        ]);
      }

      const added = await this.jobsRepository.addHomeowner(tx, {
        jobId: row.id,
        homeownerId: homeowner.id,
        addedBy: actor.id,
      });
      if (added) {
        await this.historyService.recordHomeownerChange(
          tx,
          row.id,
          'HOMEOWNER_ADDED',
          toUser(homeowner),
          actor.id,
        );
      }
      return toJob(row);
    });
  }

  async removeHomeowner(actor: Actor, id: string, homeownerId: string): Promise<Job> {
    const jobId = parseId(id, 'jobId');
    const userId = parseId(homeownerId, 'homeownerId');

    return this.db.transaction(async (tx) => {
      const row = await lockOwnedJob(tx, this.jobsRepository, actor, jobId);
      assertNotDeleted(row);

      const homeowner = await this.usersRepository.findById(tx, userId);
      const removed = await this.jobsRepository.removeHomeowner(tx, {
        jobId: row.id,
        homeownerId: userId,
      });
      if (removed && homeowner) {
        await this.historyService.recordHomeownerChange(
          tx,
          row.id,
          'HOMEOWNER_REMOVED',
          toUser(homeowner),
          actor.id,
        );
      }
      return toJob(row);
    });
  }

  async findManyByIds(ids: readonly string[]): Promise<Map<string, Job>> {
    const rows = await this.jobsRepository.findManyByIds(this.db, ids);
    return new Map(rows.map((row) => [row.id, toJob(row)]));
  }

  async homeownersByJobIds(jobIds: readonly string[]): Promise<Map<string, User[]>> {
    const links = await this.jobsRepository.listHomeownerLinks(this.db, jobIds);
    const userIds = [...new Set(links.map((link) => link.homeownerId))];
    const users = await this.usersRepository.findManyByIds(this.db, userIds);
    const usersById = new Map(users.map((row) => [row.id, toUser(row)]));

    const result = new Map<string, User[]>(jobIds.map((jobId) => [jobId, []]));
    for (const link of links) {
      const user = usersById.get(link.homeownerId);
      if (user) result.get(link.jobId)?.push(user);
    }
    return result;
  }

  private async loadVisibleJob(actor: Actor, jobId: string): Promise<JobRow> {
    if (actor.role === 'CONTRACTOR') {
      const row = await this.jobsRepository.findById(this.db, jobId, { includeDeleted: true });
      if (!row || row.contractorId !== actor.id) throw new NotFoundError('Job', jobId);
      return row;
    }

    const row = await this.jobsRepository.findById(this.db, jobId);
    if (!row) throw new NotFoundError('Job', jobId);
    const isMember = await this.jobsRepository.isHomeowner(this.db, jobId, actor.id);
    if (!isMember) throw new NotFoundError('Job', jobId);
    return row;
  }
}

function changesToPatch(changes: JobChanges): JobPatch {
  const patch: JobPatch = {};
  if (changes.description) patch.description = changes.description.after;
  if (changes.location) Object.assign(patch, locationToColumns(changes.location.after));
  if (changes.status) patch.status = changes.status.after;
  if (changes.costCents) patch.costCents = changes.costCents.after;
  return patch;
}
