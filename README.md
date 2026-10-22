# Renovation Project Tracker API

Backend for a tool where contractors and homeowners collaborate on renovation jobs:
job CRUD with homeowners, a chat-like message log, asynchronous PDF report export,
a full change history with undo/redo, and real-time messaging.

> Work in progress. This README grows with each feature pull request.

## Stack

- Node.js 22, TypeScript, pnpm
- Fastify + GraphQL Yoga, schema built code-first with Pothos
- PostgreSQL 17 with Drizzle ORM
- Redis (PubSub for GraphQL subscriptions across processes)
- AWS SQS and S3 (LocalStack locally; same SDK code against real AWS)

## Quick start

```bash
cp .env.example .env
docker compose up -d          # postgres, redis, localstack
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev                      # GraphQL API on http://localhost:4000/graphql (GraphiQL included)
pnpm dev:worker               # report worker, in another terminal
```

### Seeded accounts

| Email                   | Password        | Role       |
| ----------------------- | --------------- | ---------- |
| `alice@contractor.test` | `contractor123` | Contractor |
| `bob@homeowner.test`    | `homeowner123`  | Homeowner  |
| `carol@homeowner.test`  | `homeowner123`  | Homeowner  |

The seed is idempotent: running it again resets these three accounts and leaves everything else
untouched.

`docker compose up -d` starts only the infrastructure; the API and the worker run on the host
with reload. To run everything in containers, migrations included:

```bash
docker compose --profile app up --build
```

## Environment variables

Copy `.env.example` to `.env`. Every process validates these at boot and refuses to start on a
bad value.

| Variable                                      | Purpose                                             | Local default                 |
| --------------------------------------------- | --------------------------------------------------- | ----------------------------- |
| `NODE_ENV`                                    | `development`, `test` or `production`               | `development`                 |
| `PORT`                                        | HTTP port of the API                                | `4000`                        |
| `LOG_LEVEL`                                   | pino log level                                      | `debug`                       |
| `DATABASE_URL`                                | PostgreSQL connection string                        | Compose database `renovation` |
| `REDIS_URL`                                   | Redis used as PubSub between the API and the worker | Compose Redis                 |
| `JWT_SECRET`                                  | Signs login tokens, at least 16 characters          | placeholder, change it        |
| `JWT_EXPIRES_IN`                              | Token lifetime                                      | `8h`                          |
| `AWS_REGION`                                  | Region for the AWS SDK clients                      | `us-east-1`                   |
| `AWS_ENDPOINT_URL`                            | LocalStack endpoint; leave unset to target real AWS | LocalStack                    |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Credentials; LocalStack accepts any value           | `test`                        |
| `SQS_REPORTS_QUEUE_URL`                       | Queue consumed by the report worker                 | LocalStack queue `reports`    |
| `S3_REPORTS_BUCKET`                           | Bucket that stores generated PDFs                   | `reports`                     |

LocalStack is pinned to 4.14 because later releases require an auth token even on the free plan,
which would force anyone running the project to create a LocalStack account. Its init script
creates the `reports` queue with a dead letter queue (`reports-dlq`, three attempts) and the
`reports` bucket; the Compose healthcheck only passes once that script has finished.

## API usage

Every request goes to `POST /graphql`. Authenticated calls send the JWT returned by `login` as
`Authorization: Bearer <token>`. `docs/examples.graphql` collects every query and mutation
ready to paste into GraphiQL.

```bash
curl -s http://localhost:4000/graphql -H 'content-type: application/json' -d '{
  "query": "mutation { login(email: \"alice@contractor.test\", password: \"contractor123\") { token user { name role } } }"
}'
```

```bash
TOKEN=...   # from the login response
curl -s http://localhost:4000/graphql \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{ "query": "{ me { id email role } }" }'
```

Errors come back in the standard GraphQL `errors` array with a stable `extensions.code`:

| Code              | Meaning                                                                             |
| ----------------- | ----------------------------------------------------------------------------------- |
| `UNAUTHENTICATED` | Missing, malformed or expired token, or wrong credentials                           |
| `FORBIDDEN`       | Authenticated, but the role or ownership does not allow the operation               |
| `NOT_FOUND`       | The entity does not exist or is not visible to the caller                           |
| `CONFLICT`        | The operation clashes with the current state, for example a stale `expectedVersion` |
| `VALIDATION`      | Invalid input; `extensions.issues` lists each field and message                     |

## Scripts

| Script                                               | What it does                                     |
| ---------------------------------------------------- | ------------------------------------------------ |
| `pnpm dev` / `pnpm dev:worker`                       | Run the API / worker with reload on change       |
| `pnpm build`                                         | Compile to `dist/`                               |
| `pnpm test`                                          | Unit tests (Vitest)                              |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` | Static checks, same as CI                        |
| `pnpm db:generate`                                   | Generate a SQL migration from the Drizzle schema |
| `pnpm db:migrate`                                    | Apply pending migrations                         |

## Conventions

`AGENTS.md` holds the rules every contributor and AI coding agent follows here, including the
no-comments-in-code rule and the module boundaries.

## Project layout

```
src/
  api.ts          HTTP entrypoint (Fastify + Yoga)
  worker.ts       Queue consumer entrypoint
  container.ts    Composition root shared by both entrypoints
  config/         Environment validation (zod)
  db/             Drizzle client, schema and migration runner
  graphql/        Pothos builder, context and schema assembly
  infra/          Queue, storage and pubsub adapters behind interfaces
  modules/        Feature modules: graphql + service + repository each
    users/        User type, me query
    auth/         Login mutation, JWT issue and verification
  shared/         Cross-cutting helpers (errors, ids)
tests/            Integration tests against real Postgres and LocalStack
docs/             GraphQL examples and design notes
```
