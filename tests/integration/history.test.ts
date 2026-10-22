import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../helpers/app.js';

const JOB_STATE = `id costCents status version deletedAt canUndo canRedo`;

const historyQuery = `query History($id: ID!, $first: Int, $after: String) {
  job(id: $id) {
    ${JOB_STATE}
    history(first: $first, after: $after) {
      edges { cursor node { seq kind targetSeq supersededAt actor { name } changes { field before after } } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

interface JobState {
  id: string;
  costCents: number;
  status: string;
  version: number;
  deletedAt: string | null;
  canUndo: boolean;
  canRedo: boolean;
}

interface HistoryNode {
  seq: number;
  kind: string;
  targetSeq: number | null;
  supersededAt: string | null;
  actor: { name: string };
  changes: Array<{ field: string; before: unknown; after: unknown }>;
}

interface HistoryResult {
  job: JobState & {
    history: {
      edges: Array<{ cursor: string; node: HistoryNode }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
}

describe('history and undo/redo', () => {
  let app: TestApp;
  let alice: string;
  let dave: string;
  let bob: string;
  let jobId: string;

  const history = (variables: Record<string, unknown> = {}, token = alice) =>
    app.graphql<HistoryResult>(historyQuery, {
      variables: { id: jobId, first: 50, ...variables },
      token,
    });

  const update = (input: Record<string, unknown>, token = alice) =>
    app.graphql<{ updateJob: JobState }>(
      `mutation Update($id: ID!, $input: UpdateJobInput!) { updateJob(id: $id, input: $input) { ${JOB_STATE} } }`,
      { variables: { id: jobId, input }, token },
    );

  const undo = (token = alice, expectedVersion?: number) =>
    app.graphql<{ undoJobChange: JobState }>(
      `mutation Undo($jobId: ID!, $expectedVersion: Int) { undoJobChange(jobId: $jobId, expectedVersion: $expectedVersion) { ${JOB_STATE} } }`,
      { variables: { jobId, expectedVersion }, token },
    );

  const redo = (token = alice) =>
    app.graphql<{ redoJobChange: JobState }>(
      `mutation Redo($jobId: ID!) { redoJobChange(jobId: $jobId) { ${JOB_STATE} } }`,
      { variables: { jobId }, token },
    );

  beforeAll(async () => {
    app = await createTestApp();
    await app.resetDatabase();
    [alice, dave, bob] = await Promise.all([
      app.loginAs('alice@contractor.test'),
      app.loginAs('dave@contractor.test'),
      app.loginAs('bob@homeowner.test'),
    ]);
    const created = await app.graphql<{ createJob: { id: string } }>(
      `mutation { createJob(input: { description: "Kitchen remodel", location: { addressLine1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701" }, costCents: 1000000 }) { id } }`,
      { token: alice },
    );
    jobId = created.data!.createJob.id;
    await app.graphql(
      `mutation { addHomeowner(jobId: "${jobId}", email: "bob@homeowner.test") { id } }`,
      { token: alice },
    );
  });

  afterAll(() => app.close());

  it('records creation, membership and edits in order', async () => {
    await update({ costCents: 1_200_000 });
    await update({ costCents: 1_500_000, status: 'IN_PROGRESS' });

    const result = await history();

    expect(result.errors).toBeUndefined();
    const nodes = result.data!.job.history.edges.map((edge) => edge.node);
    expect(nodes.map((node) => [node.seq, node.kind])).toEqual([
      [1, 'CREATED'],
      [2, 'HOMEOWNER_ADDED'],
      [3, 'UPDATED'],
      [4, 'UPDATED'],
    ]);
    expect(nodes[3]?.changes).toEqual(
      expect.arrayContaining([
        { field: 'costCents', before: 1_200_000, after: 1_500_000 },
        { field: 'status', before: 'PLANNING', after: 'IN_PROGRESS' },
      ]),
    );
    expect(nodes.every((node) => node.actor.name === 'Alice Contractor')).toBe(true);
    expect(result.data?.job).toMatchObject({ canUndo: true, canRedo: false, version: 3 });
  });

  it('undoes the last change and exposes redo', async () => {
    const result = await undo();

    expect(result.errors).toBeUndefined();
    expect(result.data?.undoJobChange).toMatchObject({
      costCents: 1_200_000,
      status: 'PLANNING',
      version: 4,
      canUndo: true,
      canRedo: true,
    });

    const nodes = (await history()).data!.job.history.edges.map((edge) => edge.node);
    expect(nodes.at(-1)).toMatchObject({ seq: 5, kind: 'UNDONE', targetSeq: 4 });
    expect(nodes.at(-1)?.changes).toEqual(
      expect.arrayContaining([{ field: 'costCents', before: 1_500_000, after: 1_200_000 }]),
    );
  });

  it('lets homeowners read the history but not change it', async () => {
    const asBob = await history({}, bob);
    const bobUndo = await undo(bob);
    const daveUndo = await undo(dave);

    expect(asBob.errors).toBeUndefined();
    expect(asBob.data?.job.history.edges).toHaveLength(5);
    expect(bobUndo.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(daveUndo.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
  });

  it('redoes, then a new edit discards the redo stack but keeps the entries', async () => {
    const redone = await redo();
    expect(redone.data?.redoJobChange).toMatchObject({ costCents: 1_500_000, canRedo: false });

    await undo();
    const edited = await update({ costCents: 2_000_000 });
    expect(edited.data?.updateJob).toMatchObject({ costCents: 2_000_000, canRedo: false });

    const nothing = await redo();
    expect(nothing.errors?.[0]?.extensions?.code).toBe('CONFLICT');

    const nodes = (await history()).data!.job.history.edges.map((edge) => edge.node);
    const superseded = nodes.filter((node) => node.supersededAt !== null);
    expect(superseded.map((node) => node.seq)).toEqual([4]);
  });

  it('restores a deleted job through undo', async () => {
    await app.graphql(`mutation { deleteJob(id: "${jobId}") { id } }`, { token: alice });
    const gone = await app.graphql<{ jobs: Array<{ id: string }> }>('{ jobs { id } }', {
      token: alice,
    });
    expect(gone.data?.jobs).toEqual([]);

    const restored = await undo();
    expect(restored.data?.undoJobChange.deletedAt).toBeNull();

    const back = await app.graphql<{ jobs: Array<{ id: string }> }>('{ jobs { id } }', {
      token: alice,
    });
    expect(back.data?.jobs).toEqual([{ id: jobId }]);
  });

  it('respects expectedVersion on undo', async () => {
    const stale = await undo(alice, 1);

    expect(stale.errors?.[0]?.extensions?.code).toBe('CONFLICT');
  });

  it('pages the timeline with cursors', async () => {
    const first = await history({ first: 3 });
    const page = first.data!.job.history;
    expect(page.edges.map((edge) => edge.node.seq)).toEqual([1, 2, 3]);
    expect(page.pageInfo.hasNextPage).toBe(true);

    const second = await history({ first: 3, after: page.pageInfo.endCursor });
    expect(second.data!.job.history.edges.map((edge) => edge.node.seq)).toEqual([4, 5, 6]);
  });

  it('is append-only at the database level', async () => {
    const db = app.container.db;
    const rejectionReason = async (promise: Promise<unknown>): Promise<string> => {
      try {
        await promise;
        return 'no error';
      } catch (error) {
        const cause = (error as { cause?: unknown }).cause;
        return cause instanceof Error ? cause.message : (error as Error).message;
      }
    };

    await expect(
      rejectionReason(
        db.execute(sql`update job_history set changes = '{}'::jsonb where job_id = ${jobId}`),
      ),
    ).resolves.toMatch(/append-only/);
    await expect(
      rejectionReason(db.execute(sql`delete from job_history where job_id = ${jobId}`)),
    ).resolves.toMatch(/append-only/);
    expect((await history()).data?.job.history.edges.length).toBeGreaterThan(0);
  });
});
