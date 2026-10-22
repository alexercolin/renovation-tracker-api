import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../helpers/app.js';

const JOB_FIELDS = `
  id description status costCents version deletedAt
  location { addressLine1 addressLine2 city state postalCode country }
  contractor { name }
  homeowners { id email }
`;

const createJobMutation = `mutation CreateJob($input: CreateJobInput!) {
  createJob(input: $input) { ${JOB_FIELDS} }
}`;

const updateJobMutation = `mutation UpdateJob($id: ID!, $input: UpdateJobInput!) {
  updateJob(id: $id, input: $input) { ${JOB_FIELDS} }
}`;

const input = {
  description: 'Kitchen remodel',
  location: { addressLine1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701' },
};

interface JobShape {
  id: string;
  description: string;
  status: string;
  costCents: number;
  version: number;
  deletedAt: string | null;
  location: Record<string, string | null>;
  contractor: { name: string };
  homeowners: Array<{ id: string; email: string }>;
}

describe('jobs', () => {
  let app: TestApp;
  let alice: string;
  let dave: string;
  let bob: string;
  let jobId: string;

  beforeAll(async () => {
    app = await createTestApp();
    await app.resetDatabase();
    [alice, dave, bob] = await Promise.all([
      app.loginAs('alice@contractor.test'),
      app.loginAs('dave@contractor.test'),
      app.loginAs('bob@homeowner.test'),
    ]);
  });

  afterAll(() => app.close());

  it('lets a contractor create a job with defaults applied', async () => {
    const result = await app.graphql<{ createJob: JobShape }>(createJobMutation, {
      variables: { input },
      token: alice,
    });

    expect(result.errors).toBeUndefined();
    const job = result.data!.createJob;
    jobId = job.id;
    expect(job).toMatchObject({
      status: 'PLANNING',
      costCents: 0,
      version: 1,
      deletedAt: null,
      location: { addressLine2: null, country: 'US' },
      contractor: { name: 'Alice Contractor' },
      homeowners: [],
    });
  });

  it('forbids homeowners from creating jobs', async () => {
    const result = await app.graphql(createJobMutation, { variables: { input }, token: bob });

    expect(result.data).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });

  it('returns VALIDATION with field paths for bad input', async () => {
    const result = await app.graphql(createJobMutation, {
      variables: { input: { ...input, description: '  ', costCents: -5 } },
      token: alice,
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('VALIDATION');
    expect(result.errors?.[0]?.extensions?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'description' }),
        expect.objectContaining({ path: 'costCents' }),
      ]),
    );
  });

  it('keeps the job invisible to other contractors and to non-member homeowners', async () => {
    const asDave = await app.graphql<{ jobs: JobShape[] }>('{ jobs { id } }', { token: dave });
    const asBob = await app.graphql<{ jobs: JobShape[] }>('{ jobs { id } }', { token: bob });
    const daveDirect = await app.graphql(`{ job(id: "${jobId}") { id } }`, { token: dave });

    expect(asDave.data?.jobs).toEqual([]);
    expect(asBob.data?.jobs).toEqual([]);
    expect(daveDirect.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
  });

  it('adds a homeowner by email and makes the job visible to them', async () => {
    const added = await app.graphql<{ addHomeowner: JobShape }>(
      `mutation { addHomeowner(jobId: "${jobId}", email: "bob@homeowner.test") { ${JOB_FIELDS} } }`,
      { token: alice },
    );
    expect(added.errors).toBeUndefined();
    expect(added.data?.addHomeowner.homeowners).toEqual([
      expect.objectContaining({ email: 'bob@homeowner.test' }),
    ]);

    const asBob = await app.graphql<{ jobs: JobShape[] }>('{ jobs { id description } }', {
      token: bob,
    });
    expect(asBob.data?.jobs).toEqual([{ id: jobId, description: 'Kitchen remodel' }]);
  });

  it('rejects adding a contractor account or an unknown email', async () => {
    const contractor = await app.graphql(
      `mutation { addHomeowner(jobId: "${jobId}", email: "dave@contractor.test") { id } }`,
      { token: alice },
    );
    const unknown = await app.graphql(
      `mutation { addHomeowner(jobId: "${jobId}", email: "nobody@example.test") { id } }`,
      { token: alice },
    );

    expect(contractor.errors?.[0]?.extensions?.code).toBe('VALIDATION');
    expect(unknown.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
  });

  it('forbids homeowners from editing', async () => {
    const result = await app.graphql(updateJobMutation, {
      variables: { id: jobId, input: { costCents: 1 } },
      token: bob,
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });

  it('updates with optimistic locking', async () => {
    const first = await app.graphql<{ updateJob: JobShape }>(updateJobMutation, {
      variables: { id: jobId, input: { costCents: 250_000, expectedVersion: 1 } },
      token: alice,
    });
    expect(first.errors).toBeUndefined();
    expect(first.data?.updateJob).toMatchObject({ costCents: 250_000, version: 2 });

    const stale = await app.graphql(updateJobMutation, {
      variables: { id: jobId, input: { status: 'IN_PROGRESS', expectedVersion: 1 } },
      token: alice,
    });
    expect(stale.errors?.[0]?.extensions?.code).toBe('CONFLICT');
    expect(stale.errors?.[0]?.extensions).toMatchObject({ expectedVersion: 1, currentVersion: 2 });

    const noop = await app.graphql<{ updateJob: JobShape }>(updateJobMutation, {
      variables: { id: jobId, input: { costCents: 250_000 } },
      token: alice,
    });
    expect(noop.data?.updateJob.version).toBe(2);
  });

  it('requires at least one field on update', async () => {
    const result = await app.graphql(updateJobMutation, {
      variables: { id: jobId, input: { expectedVersion: 2 } },
      token: alice,
    });

    expect(result.errors?.[0]?.extensions?.code).toBe('VALIDATION');
  });

  it('removes a homeowner and revokes their access', async () => {
    const bobId = (await app.graphql<{ me: { id: string } }>('{ me { id } }', { token: bob })).data!
      .me.id;

    const removed = await app.graphql<{ removeHomeowner: JobShape }>(
      `mutation { removeHomeowner(jobId: "${jobId}", homeownerId: "${bobId}") { homeowners { id } } }`,
      { token: alice },
    );
    expect(removed.data?.removeHomeowner.homeowners).toEqual([]);

    const asBob = await app.graphql(`{ job(id: "${jobId}") { id } }`, { token: bob });
    expect(asBob.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');
  });

  it('soft-deletes and freezes the job', async () => {
    const deleted = await app.graphql<{ deleteJob: JobShape }>(
      `mutation { deleteJob(id: "${jobId}", expectedVersion: 2) { id deletedAt version } }`,
      { token: alice },
    );
    expect(deleted.errors).toBeUndefined();
    expect(deleted.data?.deleteJob).toMatchObject({ version: 3 });
    expect(deleted.data?.deleteJob.deletedAt).toEqual(expect.any(String));

    const visible = await app.graphql<{ jobs: JobShape[] }>('{ jobs { id } }', { token: alice });
    const withDeleted = await app.graphql<{ jobs: JobShape[] }>(
      '{ jobs(includeDeleted: true) { id deletedAt } }',
      { token: alice },
    );
    expect(visible.data?.jobs).toEqual([]);
    expect(withDeleted.data?.jobs).toEqual([
      { id: jobId, deletedAt: expect.any(String) as string },
    ]);

    const update = await app.graphql(updateJobMutation, {
      variables: { id: jobId, input: { costCents: 1 } },
      token: alice,
    });
    const again = await app.graphql(`mutation { deleteJob(id: "${jobId}") { id } }`, {
      token: alice,
    });
    expect(update.errors?.[0]?.extensions?.code).toBe('CONFLICT');
    expect(again.errors?.[0]?.extensions?.code).toBe('CONFLICT');
  });

  it('rejects malformed ids with VALIDATION', async () => {
    const result = await app.graphql('{ job(id: "nope") { id } }', { token: alice });

    expect(result.errors?.[0]?.extensions?.code).toBe('VALIDATION');
  });

  it('resolves contractor and homeowners for a list of jobs', async () => {
    await app.graphql(createJobMutation, { variables: { input }, token: alice });
    const second = await app.graphql<{ createJob: JobShape }>(createJobMutation, {
      variables: { input: { ...input, description: 'Bathroom' } },
      token: alice,
    });
    await app.graphql(
      `mutation { addHomeowner(jobId: "${second.data!.createJob.id}", email: "carol@homeowner.test") { id } }`,
      { token: alice },
    );

    const list = await app.graphql<{ jobs: JobShape[] }>(
      '{ jobs { description contractor { name } homeowners { email } } }',
      { token: alice },
    );

    expect(list.errors).toBeUndefined();
    expect(list.data?.jobs).toEqual([
      {
        description: 'Bathroom',
        contractor: { name: 'Alice Contractor' },
        homeowners: [{ email: 'carol@homeowner.test' }],
      },
      { description: 'Kitchen remodel', contractor: { name: 'Alice Contractor' }, homeowners: [] },
    ]);
  });
});
