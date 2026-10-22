import { type Tx } from '../../db/client.js';
import { type JobRow } from '../../db/schema/index.js';
import { type Actor } from '../../shared/actor.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import { type JobsRepository } from './jobs.repository.js';

export async function lockOwnedJob(
  tx: Tx,
  jobsRepository: JobsRepository,
  actor: Actor,
  jobId: string,
): Promise<JobRow> {
  const row = await jobsRepository.findByIdForUpdate(tx, jobId);
  if (!row || row.contractorId !== actor.id) throw new NotFoundError('Job', jobId);
  return row;
}

export function assertNotDeleted(row: JobRow): void {
  if (row.deletedAt) throw new ConflictError('Job is deleted', { id: row.id });
}

export function assertExpectedVersion(row: JobRow, expectedVersion: number | undefined): void {
  if (expectedVersion !== undefined && expectedVersion !== row.version) {
    throw new ConflictError('Job was modified since it was last read', {
      expectedVersion,
      currentVersion: row.version,
    });
  }
}
