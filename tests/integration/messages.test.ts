import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../helpers/app.js';

const sendMessageMutation = `mutation Send($jobId: ID!, $body: String!, $clientMessageId: ID) {
  sendMessage(jobId: $jobId, body: $body, clientMessageId: $clientMessageId) {
    id body clientMessageId createdAt
    sender { name }
    job { id }
  }
}`;

const messagesQuery = `query Messages($id: ID!, $first: Int, $after: String, $last: Int, $before: String) {
  job(id: $id) {
    messages(first: $first, after: $after, last: $last, before: $before) {
      edges { cursor node { body sender { name } } }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
}`;

interface MessageShape {
  id: string;
  body: string;
  clientMessageId: string | null;
  createdAt: string;
  sender: { name: string };
  job: { id: string };
}

interface ConnectionShape {
  job: {
    messages: {
      edges: Array<{ cursor: string; node: { body: string; sender: { name: string } } }>;
      pageInfo: {
        hasNextPage: boolean;
        hasPreviousPage: boolean;
        startCursor: string | null;
        endCursor: string | null;
      };
    };
  };
}

const CLIENT_ID = '019a0000-0000-7000-8000-0000000000ff';

describe('messages', () => {
  let app: TestApp;
  let alice: string;
  let dave: string;
  let bob: string;
  let carol: string;
  let jobId: string;

  const send = (token: string, body: string, clientMessageId?: string) =>
    app.graphql<{ sendMessage: MessageShape }>(sendMessageMutation, {
      variables: { jobId, body, clientMessageId },
      token,
    });

  const page = (variables: Record<string, unknown>) =>
    app.graphql<ConnectionShape>(messagesQuery, {
      variables: { id: jobId, ...variables },
      token: alice,
    });

  beforeAll(async () => {
    app = await createTestApp();
    await app.resetDatabase();
    [alice, dave, bob, carol] = await Promise.all([
      app.loginAs('alice@contractor.test'),
      app.loginAs('dave@contractor.test'),
      app.loginAs('bob@homeowner.test'),
      app.loginAs('carol@homeowner.test'),
    ]);

    const created = await app.graphql<{ createJob: { id: string } }>(
      `mutation { createJob(input: { description: "Kitchen", location: { addressLine1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701" } }) { id } }`,
      { token: alice },
    );
    jobId = created.data!.createJob.id;
    await app.graphql(
      `mutation { addHomeowner(jobId: "${jobId}", email: "bob@homeowner.test") { id } }`,
      { token: alice },
    );
  });

  afterAll(() => app.close());

  it('lets the contractor and a member homeowner exchange messages', async () => {
    const fromAlice = await send(alice, 'Hello Bob');
    const fromBob = await send(bob, 'Hi Alice');

    expect(fromAlice.errors).toBeUndefined();
    expect(fromAlice.data?.sendMessage).toMatchObject({
      body: 'Hello Bob',
      clientMessageId: null,
      sender: { name: 'Alice Contractor' },
      job: { id: jobId },
    });
    expect(fromBob.data?.sendMessage.sender.name).toBe('Bob Homeowner');
  });

  it('rejects non-members, other contractors and blank bodies', async () => {
    const fromCarol = await send(carol, 'Can I join?');
    const fromDave = await send(dave, 'Mine now');
    const blank = await send(alice, '   ');

    expect(fromCarol.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
    expect(fromDave.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
    expect(blank.errors?.[0]?.extensions?.code).toBe('VALIDATION');
  });

  it('deduplicates by clientMessageId', async () => {
    const first = await send(bob, 'Sent once', CLIENT_ID);
    const retry = await send(bob, 'Sent once', CLIENT_ID);

    expect(first.data?.sendMessage.clientMessageId).toBe(CLIENT_ID);
    expect(retry.data?.sendMessage.id).toBe(first.data?.sendMessage.id);
  });

  it('paginates oldest first with stable cursors', async () => {
    await send(alice, 'Fourth');
    await send(bob, 'Fifth');

    const firstPage = await page({ first: 2 });
    expect(firstPage.errors).toBeUndefined();
    const connection = firstPage.data!.job.messages;
    expect(connection.edges.map((edge) => edge.node.body)).toEqual(['Hello Bob', 'Hi Alice']);
    expect(connection.pageInfo).toMatchObject({ hasNextPage: true, hasPreviousPage: false });

    const secondPage = await page({ first: 2, after: connection.pageInfo.endCursor });
    expect(secondPage.data!.job.messages.edges.map((edge) => edge.node.body)).toEqual([
      'Sent once',
      'Fourth',
    ]);

    const lastPage = await page({
      first: 2,
      after: secondPage.data!.job.messages.pageInfo.endCursor,
    });
    expect(lastPage.data!.job.messages.edges.map((edge) => edge.node.body)).toEqual(['Fifth']);
    expect(lastPage.data!.job.messages.pageInfo.hasNextPage).toBe(false);
  });

  it('paginates backward from the newest message', async () => {
    const newest = await page({ last: 2 });

    const connection = newest.data!.job.messages;
    expect(connection.edges.map((edge) => edge.node.body)).toEqual(['Fourth', 'Fifth']);
    expect(connection.pageInfo.hasPreviousPage).toBe(true);

    const previous = await page({ last: 2, before: connection.pageInfo.startCursor });
    expect(previous.data!.job.messages.edges.map((edge) => edge.node.body)).toEqual([
      'Hi Alice',
      'Sent once',
    ]);
  });

  it('rejects malformed cursors and oversized pages with VALIDATION', async () => {
    const badCursor = await page({ first: 2, after: 'bm90LWEtdXVpZA' });
    const tooMany = await page({ first: 500 });

    expect(badCursor.errors?.[0]?.extensions?.code).toBe('VALIDATION');
    expect(tooMany.errors?.[0]?.extensions?.code).toBe('VALIDATION');
  });

  it('keeps the log readable after the job is deleted but refuses new messages', async () => {
    await app.graphql(`mutation { deleteJob(id: "${jobId}") { id } }`, { token: alice });

    const blocked = await send(alice, 'Too late');
    const history = await page({ first: 10 });

    expect(blocked.errors?.[0]?.extensions?.code).toBe('CONFLICT');
    expect(history.data?.job.messages.edges).toHaveLength(5);
  });
});
