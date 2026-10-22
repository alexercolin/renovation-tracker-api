import { setTimeout as sleep } from 'node:timers/promises';

import { type Client, createClient, type ExecutionResult } from 'graphql-ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pollOnce, type ReportWorkerDeps } from '../../src/modules/reports/reports.worker.js';
import { createTestApp, type TestApp } from '../helpers/app.js';

interface SubscriptionError {
  message: string;
  extensions?: { code?: string };
}

type Outcome<T> = { events: T[]; errors: SubscriptionError[] };

function collect<T>(
  client: Client,
  query: string,
  variables: Record<string, unknown>,
  count: number,
  timeoutMs = 5_000,
): { ready: Promise<void>; result: Promise<Outcome<T>> } {
  const outcome: Outcome<T> = { events: [], errors: [] };
  let settle: (value: Outcome<T>) => void;
  const result = new Promise<Outcome<T>>((resolve) => {
    settle = resolve;
  });
  const timer = setTimeout(() => settle(outcome), timeoutMs);
  const finish = () => {
    clearTimeout(timer);
    settle(outcome);
  };

  const unsubscribe = client.subscribe<T>(
    { query, variables },
    {
      next: (payload: ExecutionResult<T>) => {
        if (payload.errors) {
          outcome.errors.push(...(payload.errors as readonly SubscriptionError[]));
          finish();
          return;
        }
        if (payload.data) outcome.events.push(payload.data);
        if (outcome.events.length >= count) {
          unsubscribe();
          finish();
        }
      },
      error: (error: unknown) => {
        const list = Array.isArray(error) ? error : [error];
        outcome.errors.push(...(list as SubscriptionError[]));
        finish();
      },
      complete: finish,
    },
  );

  return { ready: sleep(300), result };
}

describe('realtime subscriptions', () => {
  let app: TestApp;
  let baseUrl: string;
  let alice: string;
  let bob: string;
  let carol: string;
  let jobId: string;
  const clients: Client[] = [];

  const connect = (token?: string) => {
    const client = createClient({
      url: `${baseUrl.replace('http', 'ws')}/graphql`,
      webSocketImpl: WebSocket,
      connectionParams: token ? { authorization: `Bearer ${token}` } : {},
      retryAttempts: 0,
    });
    clients.push(client);
    return client;
  };

  beforeAll(async () => {
    app = await createTestApp();
    await app.resetDatabase();
    baseUrl = await app.listen();
    [alice, bob, carol] = await Promise.all([
      app.loginAs('alice@contractor.test'),
      app.loginAs('bob@homeowner.test'),
      app.loginAs('carol@homeowner.test'),
    ]);
    const created = await app.graphql<{ createJob: { id: string } }>(
      `mutation { createJob(input: { description: "Deck", location: { addressLine1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701" } }) { id } }`,
      { token: alice },
    );
    jobId = created.data!.createJob.id;
    await app.graphql(
      `mutation { addHomeowner(jobId: "${jobId}", email: "bob@homeowner.test") { id } }`,
      { token: alice },
    );
  });

  afterAll(async () => {
    for (const client of clients) await client.dispose();
    await app.close();
  });

  it('delivers new messages to a subscribed homeowner over WebSocket', async () => {
    const subscription = collect<{ messageAdded: { body: string; sender: { name: string } } }>(
      connect(bob),
      'subscription ($jobId: ID!) { messageAdded(jobId: $jobId) { body sender { name } job { id } } }',
      { jobId },
      2,
    );
    await subscription.ready;

    await app.graphql(`mutation { sendMessage(jobId: "${jobId}", body: "Hello Bob") { id } }`, {
      token: alice,
    });
    await app.graphql(`mutation { sendMessage(jobId: "${jobId}", body: "Hi Alice") { id } }`, {
      token: bob,
    });

    const { events, errors } = await subscription.result;
    expect(errors).toEqual([]);
    expect(events.map((event) => event.messageAdded)).toEqual([
      { body: 'Hello Bob', sender: { name: 'Alice Contractor' }, job: { id: jobId } },
      { body: 'Hi Alice', sender: { name: 'Bob Homeowner' }, job: { id: jobId } },
    ]);
  });

  it('rejects subscriptions from non-members and from invalid tokens', async () => {
    const asCarol = collect(
      connect(carol),
      'subscription ($jobId: ID!) { messageAdded(jobId: $jobId) { id } }',
      { jobId },
      1,
      2_000,
    );
    const badToken = collect(
      connect('not.a.jwt'),
      'subscription ($jobId: ID!) { messageAdded(jobId: $jobId) { id } }',
      { jobId },
      1,
      2_000,
    );

    const [carolOutcome, tokenOutcome] = await Promise.all([asCarol.result, badToken.result]);

    expect(carolOutcome.events).toEqual([]);
    expect(carolOutcome.errors[0]?.extensions?.code).toBe('NOT_FOUND');
    expect(tokenOutcome.events).toEqual([]);
    expect(tokenOutcome.errors[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });

  it('streams report status changes produced by the worker through Redis', async () => {
    const requested = await app.graphql<{ requestReport: { id: string } }>(
      `mutation { requestReport(jobId: "${jobId}") { id status } }`,
      { token: alice },
    );
    const reportId = requested.data!.requestReport.id;

    const subscription = collect<{ reportUpdated: { status: string; downloadUrl: string | null } }>(
      connect(alice),
      'subscription ($reportId: ID!) { reportUpdated(reportId: $reportId) { status downloadUrl } }',
      { reportId },
      2,
      15_000,
    );
    await subscription.ready;

    const workerDeps: ReportWorkerDeps = {
      queue: app.container.queue,
      reports: app.container.services.reports,
      logger: app.container.logger,
    };
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const outcomes = await pollOnce(workerDeps, { maxMessages: 10, waitSeconds: 1 });
      if (outcomes.includes('processed')) break;
    }

    const { events, errors } = await subscription.result;
    expect(errors).toEqual([]);
    expect(events.map((event) => event.reportUpdated.status)).toEqual(['PROCESSING', 'COMPLETED']);
    expect(events[1]?.reportUpdated.downloadUrl).toMatch(/^http/);
  });
});
