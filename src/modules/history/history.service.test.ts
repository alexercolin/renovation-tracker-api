import { beforeEach, describe, expect, it } from 'vitest';

import { type Actor } from '../../shared/actor.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import { type Job } from '../jobs/jobs.types.js';
import { createFakeServices } from '../services.fake.js';
import { userRow } from '../users/users.repository.fake.js';
import { HistoryIntegrityError } from './history.types.js';

const alice: Actor = { id: '019a0000-0000-7000-8000-00000000000a', role: 'CONTRACTOR' };
const dave: Actor = { id: '019a0000-0000-7000-8000-00000000000d', role: 'CONTRACTOR' };
const bob: Actor = { id: '019a0000-0000-7000-8000-00000000000b', role: 'HOMEOWNER' };

type Fake = ReturnType<typeof createFakeServices>;

describe('HistoryService', () => {
  let fake: Fake;
  let job: Job;

  const timeline = async () =>
    (await fake.services.history.listJobHistory(job.id, { limit: 100, inverted: false })).map(
      (entry) => ({
        seq: entry.seq,
        kind: entry.kind,
        targetSeq: entry.targetSeq,
        superseded: entry.supersededAt !== null,
      }),
    );

  const current = () => fake.services.jobs.getJob(alice, job.id);

  beforeEach(async () => {
    fake = createFakeServices({
      users: [
        userRow({ id: alice.id, email: 'alice@contractor.test' }),
        userRow({ id: dave.id, email: 'dave@contractor.test' }),
        userRow({ id: bob.id, email: 'bob@homeowner.test', role: 'HOMEOWNER' }),
      ],
    });
    job = await fake.services.jobs.createJob(alice, {
      description: 'Kitchen remodel',
      location: { addressLine1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701' },
      costCents: 10_000,
    });
  });

  it('records creation as a non-undoable first entry', async () => {
    expect(await timeline()).toEqual([
      { seq: 1, kind: 'CREATED', targetSeq: null, superseded: false },
    ]);
    expect(job.historyCursor).toBe(0);
    await expect(fake.services.history.undo(alice, job.id)).rejects.toThrow('Nothing to undo');
  });

  it('walks the editor scenario: edit, edit, undo, undo, redo, edit', async () => {
    await fake.services.jobs.updateJob(alice, job.id, { costCents: 12_000 });
    await fake.services.jobs.updateJob(alice, job.id, { costCents: 15_000 });
    expect((await current()).historyCursor).toBe(3);

    const afterFirstUndo = await fake.services.history.undo(alice, job.id);
    expect(afterFirstUndo).toMatchObject({ costCents: 12_000, historyCursor: 2, version: 4 });

    const afterSecondUndo = await fake.services.history.undo(alice, job.id);
    expect(afterSecondUndo).toMatchObject({ costCents: 10_000, historyCursor: 0, version: 5 });
    await expect(fake.services.history.undo(alice, job.id)).rejects.toThrow('Nothing to undo');

    const afterRedo = await fake.services.history.redo(alice, job.id);
    expect(afterRedo).toMatchObject({ costCents: 12_000, historyCursor: 2, version: 6 });
    expect(await fake.services.history.jobIdsWithRedo([job.id])).toEqual(new Set([job.id]));

    await fake.services.jobs.updateJob(alice, job.id, { status: 'IN_PROGRESS' });
    expect(await fake.services.history.jobIdsWithRedo([job.id])).toEqual(new Set());
    await expect(fake.services.history.redo(alice, job.id)).rejects.toThrow('Nothing to redo');

    expect(await timeline()).toEqual([
      { seq: 1, kind: 'CREATED', targetSeq: null, superseded: false },
      { seq: 2, kind: 'UPDATED', targetSeq: null, superseded: false },
      { seq: 3, kind: 'UPDATED', targetSeq: null, superseded: true },
      { seq: 4, kind: 'UNDONE', targetSeq: 3, superseded: false },
      { seq: 5, kind: 'UNDONE', targetSeq: 2, superseded: false },
      { seq: 6, kind: 'REDONE', targetSeq: 2, superseded: false },
      { seq: 7, kind: 'UPDATED', targetSeq: null, superseded: false },
    ]);
    expect((await current()).historyCursor).toBe(7);
  });

  it('records inverted changes on undo so the timeline shows what actually happened', async () => {
    await fake.services.jobs.updateJob(alice, job.id, { costCents: 12_000 });
    await fake.services.history.undo(alice, job.id);

    const [, , undone] = await fake.services.history.listJobHistory(job.id, {
      limit: 10,
      inverted: false,
    });

    expect(undone?.changes).toEqual([{ field: 'costCents', before: 12_000, after: 10_000 }]);
  });

  it('restores a composite location on undo', async () => {
    const original = job.location;
    await fake.services.jobs.updateJob(alice, job.id, {
      location: { ...original, addressLine2: 'Unit 4', city: 'Dallas' },
    });

    const restored = await fake.services.history.undo(alice, job.id);

    expect(restored.location).toEqual(original);
  });

  it('undoes and redoes a deletion', async () => {
    await fake.services.jobs.deleteJob(alice, job.id);
    await expect(fake.services.jobs.listJobs(alice)).resolves.toEqual([]);

    const restored = await fake.services.history.undo(alice, job.id);
    expect(restored.deletedAt).toBeNull();
    await expect(fake.services.jobs.listJobs(alice)).resolves.toHaveLength(1);

    const deletedAgain = await fake.services.history.redo(alice, job.id);
    expect(deletedAgain.deletedAt).toBeInstanceOf(Date);
    expect((await timeline()).map((entry) => entry.kind)).toEqual([
      'CREATED',
      'DELETED',
      'UNDONE',
      'REDONE',
    ]);
  });

  it('logs homeowner changes without making them undoable', async () => {
    await fake.services.jobs.updateJob(alice, job.id, { costCents: 12_000 });
    await fake.services.jobs.addHomeowner(alice, job.id, 'bob@homeowner.test');
    await fake.services.jobs.addHomeowner(alice, job.id, 'bob@homeowner.test');
    await fake.services.jobs.removeHomeowner(alice, job.id, bob.id);

    expect((await timeline()).map((entry) => entry.kind)).toEqual([
      'CREATED',
      'UPDATED',
      'HOMEOWNER_ADDED',
      'HOMEOWNER_REMOVED',
    ]);
    expect((await current()).historyCursor).toBe(2);

    const undone = await fake.services.history.undo(alice, job.id);
    expect(undone.costCents).toBe(10_000);
  });

  it('enforces expectedVersion and ownership', async () => {
    await fake.services.jobs.updateJob(alice, job.id, { costCents: 12_000 });

    await expect(fake.services.history.undo(alice, job.id, 1)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(fake.services.history.undo(dave, job.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(fake.services.history.undo(bob, job.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to undo when the current value no longer matches the recorded one', async () => {
    await fake.services.jobs.updateJob(alice, job.id, { costCents: 12_000 });
    const row = fake.repositories.jobs.rows.get(job.id)!;
    fake.repositories.jobs.rows.set(job.id, { ...row, costCents: 99 });

    await expect(fake.services.history.undo(alice, job.id)).rejects.toBeInstanceOf(
      HistoryIntegrityError,
    );
    expect(fake.repositories.jobs.rows.get(job.id)?.costCents).toBe(99);
  });

  it('pages the timeline by seq in both directions', async () => {
    for (const costCents of [11_000, 12_000, 13_000]) {
      await fake.services.jobs.updateJob(alice, job.id, { costCents });
    }

    const forward = await fake.services.history.listJobHistory(job.id, {
      afterSeq: 1,
      limit: 2,
      inverted: false,
    });
    const backward = await fake.services.history.listJobHistory(job.id, {
      beforeSeq: 4,
      limit: 2,
      inverted: true,
    });

    expect(forward.map((entry) => entry.seq)).toEqual([2, 3]);
    expect(backward.map((entry) => entry.seq)).toEqual([3, 2]);
  });
});
