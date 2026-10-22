# Guide for contributors and AI coding agents

Backend for a home renovation project tracker where contractors and homeowners collaborate on
jobs. GraphQL API built with Fastify, GraphQL Yoga and Pothos; PostgreSQL through Drizzle;
Redis as PubSub for subscriptions; SQS and S3 through the AWS SDK, served locally by LocalStack.
One package with two entrypoints: `src/api.ts` (HTTP) and `src/worker.ts` (queue consumer).
`README.md` has setup, commands, API examples and the tradeoffs behind each decision.

## Comments

No comments in code. None: no line comments, block comments, JSDoc, TODOs or commented-out
code, in TypeScript, JavaScript, SQL, shell, YAML, Dockerfiles or env files. Names and
structure carry the intent. Anything that needs explaining goes in `README.md` or `docs/`.
Remove any comment you come across. Inline lint or type suppressions are comments too: fix the
code or change the rule in `eslint.config.js`.

## Commits

Commit messages follow Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`,
`refactor:`).

## Architecture rules

- Feature modules live in `src/modules/<feature>/` with `<feature>.graphql.ts` (Pothos types
  and fields), `<feature>.service.ts` (business rules and transactions),
  `<feature>.repository.ts` (SQL through Drizzle) and unit tests beside them as `*.test.ts`.
- GraphQL files only translate: read arguments, call a service, return the result. No business
  rules and no SQL in them.
- Services own rules and transactions. Repositories receive the executor as a parameter
  (`Db` or `Tx` from `src/db/client.ts`) so a service can compose several repositories inside
  one transaction.
- Modules talk to each other through services. The single sanctioned exception: the history
  service writes job fields through the jobs repository, because undo and redo are writes to
  the job row. Dependency direction is jobs repository, then history service, then jobs service.
- Infrastructure (queue, storage, pubsub, pdf) lives in `src/infra/` behind small interfaces,
  with one AWS or Redis implementation and one in-memory implementation for tests. Modules never
  import the AWS SDK or the Redis client directly.
- `src/container.ts` is the only place that instantiates infrastructure, repositories and
  services. Both entrypoints build the same container.
- Domain errors are classes in `src/shared/errors.ts`, mapped once to GraphQL
  `extensions.code` (`NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `VALIDATION`). Resolvers never build
  GraphQL errors by hand.
- Authorization has two layers: role per field through the Pothos scope-auth plugin, and
  ownership or membership checks inside services.
- Money is stored and exposed as integer cents. Timestamps are `timestamptz`. Ids are UUID v7
  generated in the application.
- Jobs are soft-deleted (`deleted_at`). Repositories apply the `deleted_at IS NULL` filter;
  callers never repeat it.
- `job_history` is append-only. The only permitted update is setting `superseded_at`. Undo and
  redo are linear (last applied change first), run inside a transaction that locks the job row,
  and verify the current value matches the recorded one before writing.
- Lists that grow without bound (messages, history) are Relay connections with keyset cursors.
  Bounded lists (a contractor's jobs, a job's homeowners) are plain arrays.
- Unit tests sit beside the code with in-memory fakes. Integration tests live in `tests/` and
  run against the real Postgres and LocalStack from `docker-compose.yml`.
