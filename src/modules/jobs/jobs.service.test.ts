import { beforeEach, describe, expect, it } from 'vitest';

import { type Actor } from '../../shared/actor.js';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { FakeUsersRepository, userRow } from '../users/users.repository.fake.js';
import { fakeDb, FakeJobsRepository } from './jobs.repository.fake.js';
import { JobsService } from './jobs.service.js';

const alice: Actor = { id: '019a0000-0000-7000-8000-00000000000a', role: 'CONTRACTOR' };
const dave: Actor = { id: '019a0000-0000-7000-8000-00000000000d', role: 'CONTRACTOR' };
const bob: Actor = { id: '019a0000-0000-7000-8000-00000000000b', role: 'HOMEOWNER' };

const validInput = {
  description: 'Kitchen remodel',
  location: { addressLine1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701' },
};

describe('JobsService', () => {
  let jobsRepository: FakeJobsRepository;
  let service: JobsService;

  beforeEach(() => {
    jobsRepository = new FakeJobsRepository();
    const usersRepository = new FakeUsersRepository([
      userRow({ id: alice.id, email: 'alice@contractor.test' }),
      userRow({ id: dave.id, email: 'dave@contractor.test' }),
      userRow({ id: bob.id, email: 'bob@homeowner.test', role: 'HOMEOWNER' }),
    ]);
    service = new JobsService(fakeDb(), jobsRepository, usersRepository);
  });

  describe('createJob', () => {
    it('applies defaults and normalises the location', async () => {
      const job = await service.createJob(alice, {
        ...validInput,
        location: { ...validInput.location, addressLine2: '', country: 'us' },
      });

      expect(job).toMatchObject({
        contractorId: alice.id,
        status: 'PLANNING',
        costCents: 0,
        version: 1,
        deletedAt: null,
        location: { addressLine2: null, country: 'US' },
      });
    });

    it('rejects invalid input with field paths', async () => {
      const error = await service
        .createJob(alice, { description: ' ', location: { city: 'Austin' }, costCents: -1 })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ValidationError);
      const paths = ((error as ValidationError).details?.issues as Array<{ path: string }>).map(
        (issue) => issue.path,
      );
      expect(paths).toEqual(
        expect.arrayContaining(['description', 'location.addressLine1', 'costCents']),
      );
    });
  });

  describe('visibility', () => {
    it('hides a job from other contractors and from homeowners who are not members', async () => {
      const job = await service.createJob(alice, validInput);

      await expect(service.getJob(alice, job.id)).resolves.toMatchObject({ id: job.id });
      await expect(service.getJob(dave, job.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.getJob(bob, job.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.listJobs(dave)).resolves.toEqual([]);
      await expect(service.listJobs(bob)).resolves.toEqual([]);
    });

    it('shows a job to a homeowner once added, and hides it again when removed', async () => {
      const job = await service.createJob(alice, validInput);

      await service.addHomeowner(alice, job.id, 'Bob@Homeowner.test');
      await expect(service.getJob(bob, job.id)).resolves.toMatchObject({ id: job.id });
      await expect(service.listJobs(bob)).resolves.toHaveLength(1);

      await service.removeHomeowner(alice, job.id, bob.id);
      await expect(service.getJob(bob, job.id)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('keeps deleted jobs visible to the contractor only when asked', async () => {
      const job = await service.createJob(alice, validInput);
      await service.addHomeowner(alice, job.id, 'bob@homeowner.test');
      await service.deleteJob(alice, job.id);

      await expect(service.listJobs(alice)).resolves.toEqual([]);
      await expect(service.listJobs(alice, { includeDeleted: true })).resolves.toHaveLength(1);
      await expect(service.getJob(alice, job.id)).resolves.toMatchObject({
        deletedAt: expect.any(Date) as Date,
      });
      await expect(service.getJob(bob, job.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.listJobs(bob)).resolves.toEqual([]);
    });

    it('rejects malformed ids before querying', async () => {
      await expect(service.getJob(alice, 'not-a-uuid')).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('updateJob', () => {
    it('bumps the version only when something actually changes', async () => {
      const job = await service.createJob(alice, validInput);

      const unchanged = await service.updateJob(alice, job.id, { costCents: 0 });
      expect(unchanged.version).toBe(1);

      const changed = await service.updateJob(alice, job.id, { costCents: 12_000 });
      expect(changed).toMatchObject({ version: 2, costCents: 12_000 });
    });

    it('enforces expectedVersion', async () => {
      const job = await service.createJob(alice, validInput);
      await service.updateJob(alice, job.id, { status: 'IN_PROGRESS' });

      const error = await service
        .updateJob(alice, job.id, { status: 'COMPLETED', expectedVersion: 1 })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).details).toEqual({ expectedVersion: 1, currentVersion: 2 });
    });

    it('requires at least one field', async () => {
      const job = await service.createJob(alice, validInput);

      await expect(service.updateJob(alice, job.id, { expectedVersion: 1 })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('refuses to touch a deleted job', async () => {
      const job = await service.createJob(alice, validInput);
      await service.deleteJob(alice, job.id);

      await expect(service.updateJob(alice, job.id, { costCents: 5 })).rejects.toBeInstanceOf(
        ConflictError,
      );
      await expect(
        service.addHomeowner(alice, job.id, 'bob@homeowner.test'),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('is invisible to other contractors', async () => {
      const job = await service.createJob(alice, validInput);

      await expect(service.updateJob(dave, job.id, { costCents: 5 })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe('deleteJob', () => {
    it('soft-deletes once and conflicts on the second attempt', async () => {
      const job = await service.createJob(alice, validInput);

      const deleted = await service.deleteJob(alice, job.id, 1);
      expect(deleted.deletedAt).toBeInstanceOf(Date);
      expect(deleted.version).toBe(2);

      await expect(service.deleteJob(alice, job.id)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('homeowners', () => {
    it('rejects unknown emails and non-homeowner accounts', async () => {
      const job = await service.createJob(alice, validInput);

      await expect(
        service.addHomeowner(alice, job.id, 'nobody@example.test'),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        service.addHomeowner(alice, job.id, 'dave@contractor.test'),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('treats repeated add and remove as no-ops', async () => {
      const job = await service.createJob(alice, validInput);

      await service.addHomeowner(alice, job.id, 'bob@homeowner.test');
      await service.addHomeowner(alice, job.id, 'bob@homeowner.test');
      expect(jobsRepository.links).toHaveLength(1);

      await service.removeHomeowner(alice, job.id, bob.id);
      await service.removeHomeowner(alice, job.id, bob.id);
      expect(jobsRepository.links).toHaveLength(0);
    });

    it('does not change the job version', async () => {
      const job = await service.createJob(alice, validInput);

      const after = await service.addHomeowner(alice, job.id, 'bob@homeowner.test');

      expect(after.version).toBe(1);
    });

    it('batches homeowner lookups per job', async () => {
      const first = await service.createJob(alice, validInput);
      const second = await service.createJob(alice, validInput);
      await service.addHomeowner(alice, first.id, 'bob@homeowner.test');

      const result = await service.homeownersByJobIds([first.id, second.id, 'missing']);

      expect(result.get(first.id)?.map((user) => user.id)).toEqual([bob.id]);
      expect(result.get(second.id)).toEqual([]);
      expect(result.get('missing')).toEqual([]);
    });
  });
});
