import { beforeEach, describe, expect, it } from 'vitest';

import { type Actor } from '../../shared/actor.js';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { type JobsService } from '../jobs/jobs.service.js';
import { createFakeServices } from '../services.fake.js';
import { userRow } from '../users/users.repository.fake.js';
import { type FakeMessagesRepository } from './messages.repository.fake.js';
import { type MessagesService } from './messages.service.js';

const alice: Actor = { id: '019a0000-0000-7000-8000-00000000000a', role: 'CONTRACTOR' };
const dave: Actor = { id: '019a0000-0000-7000-8000-00000000000d', role: 'CONTRACTOR' };
const bob: Actor = { id: '019a0000-0000-7000-8000-00000000000b', role: 'HOMEOWNER' };
const carol: Actor = { id: '019a0000-0000-7000-8000-00000000000c', role: 'HOMEOWNER' };

const CLIENT_ID = '019a0000-0000-7000-8000-0000000000ff';

describe('MessagesService', () => {
  let jobsService: JobsService;
  let messagesRepository: FakeMessagesRepository;
  let service: MessagesService;
  let jobId: string;

  beforeEach(async () => {
    const fake = createFakeServices({
      users: [
        userRow({ id: alice.id, email: 'alice@contractor.test' }),
        userRow({ id: dave.id, email: 'dave@contractor.test' }),
        userRow({ id: bob.id, email: 'bob@homeowner.test', role: 'HOMEOWNER' }),
        userRow({ id: carol.id, email: 'carol@homeowner.test', role: 'HOMEOWNER' }),
      ],
    });
    jobsService = fake.services.jobs;
    messagesRepository = fake.repositories.messages;
    service = fake.services.messages;

    const job = await jobsService.createJob(alice, {
      description: 'Kitchen remodel',
      location: { addressLine1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701' },
    });
    jobId = job.id;
    await jobsService.addHomeowner(alice, jobId, 'bob@homeowner.test');
  });

  it('lets the contractor and member homeowners post, trimming the body', async () => {
    const fromAlice = await service.sendMessage(alice, { jobId, body: '  Hello  ' });
    const fromBob = await service.sendMessage(bob, { jobId, body: 'Hi' });

    expect(fromAlice).toMatchObject({
      jobId,
      senderId: alice.id,
      body: 'Hello',
      clientMessageId: null,
    });
    expect(fromBob.senderId).toBe(bob.id);
  });

  it('hides the job from non-members and other contractors', async () => {
    await expect(service.sendMessage(carol, { jobId, body: 'Hi' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(service.sendMessage(dave, { jobId, body: 'Hi' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('rejects blank bodies and malformed ids', async () => {
    await expect(service.sendMessage(alice, { jobId, body: '   ' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(service.sendMessage(alice, { jobId: 'nope', body: 'x' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('refuses messages on a deleted job', async () => {
    await jobsService.deleteJob(alice, jobId);

    await expect(service.sendMessage(alice, { jobId, body: 'Hi' })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('returns the original message when the same clientMessageId is resent', async () => {
    const first = await service.sendMessage(bob, { jobId, body: 'Hi', clientMessageId: CLIENT_ID });
    const retry = await service.sendMessage(bob, { jobId, body: 'Hi', clientMessageId: CLIENT_ID });

    expect(retry.id).toBe(first.id);
    expect(messagesRepository.rows).toHaveLength(1);
  });

  it('scopes clientMessageId per sender', async () => {
    await service.sendMessage(alice, { jobId, body: 'A', clientMessageId: CLIENT_ID });
    await service.sendMessage(bob, { jobId, body: 'B', clientMessageId: CLIENT_ID });

    expect(messagesRepository.rows).toHaveLength(2);
  });

  it('conflicts when a clientMessageId is reused for another job', async () => {
    const other = await jobsService.createJob(alice, {
      description: 'Bathroom',
      location: { addressLine1: '2 Main St', city: 'Austin', state: 'TX', postalCode: '78701' },
    });
    await service.sendMessage(alice, { jobId, body: 'A', clientMessageId: CLIENT_ID });

    await expect(
      service.sendMessage(alice, { jobId: other.id, body: 'A', clientMessageId: CLIENT_ID }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('pages forward and backward with keyset cursors', async () => {
    const sent = [];
    for (const body of ['1', '2', '3', '4', '5']) {
      sent.push(await service.sendMessage(alice, { jobId, body }));
    }

    const firstPage = await service.listJobMessages(jobId, { limit: 2, inverted: false });
    expect(firstPage.map((m) => m.body)).toEqual(['1', '2']);

    const secondPage = await service.listJobMessages(jobId, {
      afterId: firstPage[1]!.id,
      limit: 2,
      inverted: false,
    });
    expect(secondPage.map((m) => m.body)).toEqual(['3', '4']);

    const backward = await service.listJobMessages(jobId, {
      beforeId: sent[4]!.id,
      limit: 2,
      inverted: true,
    });
    expect(backward.map((m) => m.body)).toEqual(['4', '3']);
  });
});
