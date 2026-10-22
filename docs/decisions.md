# Decision log

Short records of the choices that shape this codebase: the context, what was decided, what was
rejected and what it costs. Newest at the bottom.

## 1. Fastify, GraphQL Yoga and Pothos

**Context.** The challenge prefers GraphQL and evaluates backend architecture and API design.

**Decision.** Fastify as the HTTP server, GraphQL Yoga as the GraphQL server, Pothos to build the
schema code-first without decorators.

**Rejected.** NestJS with Apollo (modules and dependency injection come ready, but much of the
architecture becomes the framework's, with decorators and heavier boilerplate). Express with
Apollo schema-first (SDL plus codegen duplicates every type and needs an extra build step).

**Consequences.** Type safety end to end with no codegen; subscriptions and GraphiQL come with
Yoga; structure and dependency wiring are written by hand in one composition root.

## 2. Drizzle on the stable line, relations through DataLoaders

**Context.** The history feature needs row locks and explicit transactions; the Pothos Drizzle
plugin, which resolves relations automatically, requires a Drizzle 1.0 release candidate.

**Decision.** `drizzle-orm` 0.45 and `drizzle-kit` 0.31, no Pothos Drizzle plugin. Relations are
resolved with per-request DataLoaders.

**Rejected.** Prisma (row locks need raw SQL inside transactions). The Drizzle release candidate
(a pre-release ORM in a project whose point is data integrity).

**Consequences.** `FOR UPDATE` and transactions are first-class in the query builder; a handful
of explicit loaders replace automatic relation loading.

## 3. Modular monolith with one composition root

**Decision.** One package, feature modules under `src/modules/<feature>/` split into GraphQL
translation, service and repository. `src/container.ts` instantiates everything; the API and the
worker are two entrypoints over the same container. Infrastructure sits behind small interfaces
with in-memory doubles.

**Rejected.** Full hexagonal layering (ports, adapters and use cases for a domain this size reads
as ceremony). A flat design with resolvers talking to the database (nothing to evaluate).

**Consequences.** Services can be unit tested with fakes and reused by the worker; the
dependency direction is explicit and enforced by convention in `AGENTS.md`.

## 4. LocalStack pinned to 4.14

**Context.** LocalStack moved to a single image in 2026 that requires an auth token even on the
free plan.

**Decision.** Pin `localstack/localstack:4.14`, the last release that starts without a token.

**Rejected.** The current image with a free-tier token (evaluators would have to create an
account). ElasticMQ plus MinIO (two more images to learn and configure for the same result).

**Consequences.** `docker compose up` works with no credentials; the pin is frozen and documented.

## 5. Errors as GraphQL errors with stable codes

**Decision.** Domain errors are classes mapped once, in the Yoga error mask, to
`extensions.code`: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `VALIDATION`.

**Rejected.** Union result types per mutation (more expressive and typed, but every mutation
needs conditional fragments and the examples double in size).

**Consequences.** Short examples and universal client support; error shapes are documented rather
than typed. Because the test runner can load two copies of `graphql`, the mask recognises a
`GraphQLError` by shape instead of `instanceof`.

## 6. Money as integer cents

**Decision.** `cost_cents integer` in the database, `Int` in GraphQL, USD only.

**Rejected.** `numeric(12,2)` with a custom `Decimal` scalar (strings everywhere and a custom
scalar for a range the domain does not need). Floating point (never for money).

**Consequences.** Exact arithmetic and simple JSON; a cap of about 21 million dollars that a
`BigInt` scalar would lift.

## 7. Soft delete that freezes the job

**Decision.** Deleting sets `deleted_at`. Repositories filter it out; the contractor can still
read the job with `job(id)` or `jobs(includeDeleted: true)`; every mutation on a deleted job
answers `CONFLICT`.

**Rejected.** Hard delete with cascades (destroys the audit trail the history feature requires).

**Consequences.** Nothing is ever lost; undo in the history feature restores a deleted job through
the same mechanism as any other field change.

## 8. Visibility answers NOT_FOUND

**Decision.** A job is visible to its contractor and its homeowners. Everyone else gets
`NOT_FOUND`, for reads and writes alike. `FORBIDDEN` only comes from the role check on a field.

**Consequences.** Ids cannot be probed across contractors; the two codes have one meaning each.

## 9. Optimistic locking with an optional expectedVersion

**Decision.** Every job carries a `version` incremented inside the update statement. Clients may
send `expectedVersion`; a mismatch is `CONFLICT` with both versions in the error. No-op updates
and homeowner changes do not bump the version.

**Consequences.** Lost updates are detectable without forcing every client to track versions; the
version has one meaning, changes to the job's own fields, which the undo stack will rely on.

## 10. Job history as a change log with a cursor

**Context.** The required advanced feature is a full history of job changes with undo and redo.

**Decision.** An append-only `job_history` table stores, per entry, the changed fields with
before and after values; `jobs.history_cursor` points at the last applied undoable entry. Undo
writes the before values, redo the after values, both inside a transaction that locks the job
row and verifies the current value matches the recorded one. Undo is linear, last change first;
a new edit marks the discarded redo entries as superseded instead of deleting them.

**Rejected.** Event sourcing (the history becomes the source of truth and the job a projection;
replay and rebuild for a single small aggregate). Snapshots per revision (restoring is trivial
but the timeline needs a diff step and the cursor logic is the same).

**Consequences.** The row is the diff, so the timeline costs no computation; nothing is ever
deleted; selective undo of an arbitrary entry is deliberately unsupported. Implemented in the
second pull request.

## 11. Messages: keyset cursors by id and idempotent sends

**Decision.** `job.messages` is a Relay connection whose cursor is the message id; the database
resolves the position with a subselect over `(created_at, id)`. `sendMessage` accepts an optional
client-generated id enforced by a partial unique index, so retries return the original message.

**Rejected.** Offset pagination (unstable while the chat grows). Timestamps inside cursors
(microsecond truncation between Postgres and JavaScript dates).

**Consequences.** Pages stay correct while messages arrive; the same forward cursor serves a
client catching up after a disconnect.

## 12. Reports: SQS, a worker and streaming PDFs

**Decision.** `requestReport` stores a `PENDING` row, commits, then sends the id to SQS. The
worker streams a pdfkit document into S3 with a multipart upload while it reads messages in
batches. A failed attempt returns the row to `PENDING`; the third failure marks it `FAILED` and
lets the message reach the dead letter queue. Downloads are presigned URLs generated on read.

**Rejected.** SNS fan-out (no second consumer exists yet). Generating in the API process (work is
lost on a crash and competes with requests). Headless Chromium for PDFs (hundreds of megabytes in
the image for layout we do not need).

**Consequences.** Durable, retryable generation whose memory does not grow with the job. Two
remaining tradeoffs are documented: the row and the queue message are two writes (an outbox is
the production upgrade), and the 120-second visibility timeout bounds a single attempt.

## 13. Authentication and authorization

**Decision.** Seeded users with bcrypt hashes, stateless HS256 JWTs carrying the role, the
Pothos scope-auth plugin for the role per field, and ownership or membership checks inside the
services.

**Rejected.** Sessions in Redis (revocation at the cost of a lookup per request, not asked for).

**Consequences.** One token works for HTTP and WebSocket; a role change needs a new login.

## 14. Two test suites

**Decision.** Unit tests beside the code, running services over in-memory repositories and
infrastructure doubles. Integration tests in `tests/`, running GraphQL operations through the
Fastify app against the real Postgres and LocalStack from Compose, with the database migrated per
run and reset per file.

**Consequences.** The unit suite runs in under a second and covers rules and edge cases; the
integration suite proves the SQL, the auth plumbing and the AWS adapters, including a real PDF
downloaded from S3.

## 15. Real time over graphql-ws with Redis

**Context.** The chosen optional feature is live contractor and homeowner messaging; the worker
also needs to tell API clients when a report is ready.

**Decision.** GraphQL subscriptions over WebSocket with the graphql-ws protocol, mounted on the
same `/graphql` route as HTTP; Yoga's SSE transport stays available on that route. Events go
through a Redis-backed PubSub so the worker and every API instance share one stream. Events are
thin (an id); resolvers load the row on delivery. The token travels in connection parameters.

**Rejected.** SSE only (no browser header problem either, but a connection limit per origin and
not the protocol GraphQL clients default to). Socket.io (a second protocol beside GraphQL with
its own auth). Fat events carrying the full object (serialization drift across Redis).

**Consequences.** One schema and one auth path for everything; at-most-once delivery with
catch-up through the message cursor; Redis becomes a boot-time dependency of both processes.
