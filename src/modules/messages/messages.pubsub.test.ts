import { beforeEach, describe, expect, it } from 'vitest';

import { type Actor } from '../../shared/actor.js';
import { createFakeServices } from '../services.fake.js';
import { userRow } from '../users/users.repository.fake.js';

const alice: Actor = { id: '019a0000-0000-7000-8000-00000000000a', role: 'CONTRACTOR' };
const bob: Actor = { id: '019a0000-0000-7000-8000-00000000000b', role: 'HOMEOWNER' };
const CLIENT_ID = '019a0000-0000-7000-8000-0000000000ff';

describe('realtime events', () => {
  let fake: ReturnType<typeof createFakeServices>;
  let jobId: string;

  beforeEach(async () => {
    fake = createFakeServices({
      users: [
        userRow({ id: alice.id, email: 'alice@contractor.test' }),
        userRow({ id: bob.id, email: 'bob@homeowner.test', role: 'HOMEOWNER' }),
      ],
    });
    const job = await fake.services.jobs.createJob(alice, {
      description: 'Deck',
      location: { addressLine1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701' },
    });
    jobId = job.id;
    await fake.services.jobs.addHomeowner(alice, jobId, 'bob@homeowner.test');
  });

  it('publishes a messageAdded event once per stored message', async () => {
    const events = (await fake.services.messages.subscribeToJob(bob, jobId))[
      Symbol.asyncIterator
    ]();
    const first = events.next();

    const sent = await fake.services.messages.sendMessage(alice, {
      jobId,
      body: 'Hi',
      clientMessageId: CLIENT_ID,
    });
    await fake.services.messages.sendMessage(alice, {
      jobId,
      body: 'Hi',
      clientMessageId: CLIENT_ID,
    });
    const second = await fake.services.messages.sendMessage(bob, { jobId, body: 'Hello' });

    await expect(first).resolves.toMatchObject({ value: { messageId: sent.id } });
    await expect(events.next()).resolves.toMatchObject({ value: { messageId: second.id } });
  });

  it('only lets members subscribe to a job', async () => {
    const carol: Actor = { id: '019a0000-0000-7000-8000-00000000000c', role: 'HOMEOWNER' };

    await expect(fake.services.messages.subscribeToJob(carol, jobId)).rejects.toThrow(
      'Job not found',
    );
  });

  it('publishes every report status change', async () => {
    const requested = await fake.services.reports.requestReport(alice, jobId);
    const events = (await fake.services.reports.subscribeToReport(alice, requested.id))[
      Symbol.asyncIterator
    ]();
    const first = events.next();

    await fake.services.reports.processReport(requested.id);

    await expect(first).resolves.toMatchObject({ value: { reportId: requested.id } });
    await expect(events.next()).resolves.toMatchObject({ value: { reportId: requested.id } });
    await expect(fake.services.reports.getReportById(requested.id)).resolves.toMatchObject({
      status: 'COMPLETED',
    });
  });
});
