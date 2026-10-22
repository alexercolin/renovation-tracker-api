import { sql } from 'drizzle-orm';

import { type Container, createContainer } from '../../src/container.js';
import { seedDatabase, seedUsers } from '../../src/db/seed-data.js';
import { buildServer } from '../../src/server.js';
import { testEnv } from './env.js';

export interface GraphQLResponse<TData = Record<string, unknown>> {
  data: TData | null;
  errors?: Array<{ message: string; path?: string[]; extensions?: Record<string, unknown> }>;
}

export interface GraphQLCallOptions {
  variables?: Record<string, unknown>;
  token?: string;
  headers?: Record<string, string>;
}

export interface TestApp {
  container: Container;
  graphql<TData = Record<string, unknown>>(
    query: string,
    options?: GraphQLCallOptions,
  ): Promise<GraphQLResponse<TData>>;
  loginAs(email: string): Promise<string>;
  resetDatabase(): Promise<void>;
  listen(): Promise<string>;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const container = createContainer(testEnv());
  const app = await buildServer(container);

  const graphql = async <TData>(
    query: string,
    options: GraphQLCallOptions = {},
  ): Promise<GraphQLResponse<TData>> => {
    const response = await app.inject({
      method: 'POST',
      url: '/graphql',
      headers: {
        'content-type': 'application/json',
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...options.headers,
      },
      payload: { query, variables: options.variables },
    });
    return response.json<GraphQLResponse<TData>>();
  };

  return {
    container,
    graphql,
    async loginAs(email) {
      const seedUser = seedUsers.find((user) => user.email === email);
      if (!seedUser) throw new Error(`No seed user with email ${email}`);
      const result = await graphql<{ login: { token: string } }>(
        'mutation Login($email: String!, $password: String!) { login(email: $email, password: $password) { token } }',
        { variables: { email, password: seedUser.password } },
      );
      if (!result.data) throw new Error(JSON.stringify(result.errors));
      return result.data.login.token;
    },
    async resetDatabase() {
      await container.db.execute(
        sql`truncate table job_history, reports, messages, job_homeowners, jobs, users restart identity cascade`,
      );
      await seedDatabase(container.db);
    },
    async listen() {
      await app.listen({ port: 0, host: '127.0.0.1' });
      const address = app.server.address();
      if (!address || typeof address === 'string') throw new Error('server has no TCP address');
      return `http://127.0.0.1:${address.port}`;
    },
    async close() {
      await app.close();
      await container.close();
    },
  };
}
