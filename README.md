# AREDC Lead Management API

A backend service for a Real Estate Lead Management System — technical assessment for AREDC.

Node.js + TypeScript + PostgreSQL + REST, built with NestJS and Prisma. Every state
change is transactional; every business rule lives in one place; access control and
workflow rules are unit- and e2e-tested against a real database.

---

## Table of Contents

- [Quick start](#quick-start)
- [Test users](#test-users)
- [Architecture overview](#architecture-overview)
- [Workflow / state machine](#workflow--state-machine)
- [Database schema](#database-schema)
- [API overview](#api-overview)
- [Authorization matrix](#authorization-matrix)
- [Running tests](#running-tests)
- [Assumptions](#assumptions)
- [Technical decisions](#technical-decisions)
- [Trade-offs made for the 48-hour budget](#trade-offs-made-for-the-48-hour-budget)
- [What I'd change for production](#what-id-change-for-production)
- [Project structure](#project-structure)

---

## Quick start

### Prerequisites

- Docker Desktop (or Docker Engine + Compose plugin)
- Optional for local dev without containers: Node 20+, a running Postgres

### One-command boot

```bash
git clone <this-repo> real-estate-api
cd real-estate-api
cp .env.example .env
docker compose up
```

What happens:

1. `postgres` starts on `:5432`, `postgres_test` on `:5433` (both healthchecked).
2. The app image is built and started on `:3000`.
3. On boot the app runs `prisma migrate deploy` and seeds 5 test users.
4. Swagger UI is available at **http://localhost:3000/docs**.

If port 5432 is already in use on your machine (common when you have a native
Postgres installed), copy `docker-compose.override.yml.example` to
`docker-compose.override.yml` and adjust the ports — it's git-ignored.

### Local dev (no Docker for the app, DB in Docker)

```bash
docker compose up -d postgres postgres_test
npm install
npx prisma migrate deploy
npm run prisma:seed
npm run start:dev
```

---

## Test users

All seeded users share the same password: **`Passw0rd!`** (override via
`SEED_USER_PASSWORD` env var).

| Role                          | Email                            | id |
| ----------------------------- | -------------------------------- | -- |
| `LEAD_GENERATION`             | `leadgen@aredc.test`             | 1  |
| `LEAD_GENERATION_SUPERVISOR`  | `leadgen-supervisor@aredc.test`  | 2  |
| `AGENT_SUPERVISOR`            | `agent-supervisor@aredc.test`    | 3  |
| `AGENT`                       | `agent-a@aredc.test`             | 4  |
| `AGENT`                       | `agent-b@aredc.test`             | 5  |

Two agents so isolation tests can prove one AGENT can't see another AGENT's leads.

---

## Architecture overview

```
src/
├── main.ts                 Nest bootstrap: global ValidationPipe + DomainExceptionFilter + Swagger
├── app.module.ts           Wires modules, registers JwtAuthGuard + RolesGuard globally
│
├── auth/                   POST /auth/login, GET /auth/me, JwtStrategy re-fetches user each request
├── users/                  UsersService (find by id/email)
│
├── leads/
│   ├── leads.controller.ts All 11 lead endpoints
│   ├── leads.service.ts    Business logic; every mutation wrapped in prisma.$transaction
│   ├── state-machine/      transitions.ts (single source of truth) + LeadStateMachine.assertTransition
│   ├── policies/           LeadAccessPolicy (SQL WHERE + single-lead 404 check)
│   └── dto/                class-validator DTOs for every request body/query
│
├── timeline/               TimelineService.record(tx, event) + GET /leads/:id/timeline
│
├── common/
│   ├── decorators/         @Public, @Roles, @CurrentUser
│   ├── guards/             JwtAuthGuard (respects @Public), RolesGuard (@Roles metadata)
│   ├── filters/            DomainExceptionFilter -> { error: { code, message, details? } }
│   └── errors/             DomainError + one subclass per business error
│
└── prisma/                 @Global PrismaModule + PrismaService (10s interactive-tx timeout)

prisma/
├── schema.prisma           User, Lead, LeadEvent + 8 enums
├── migrations/             SQL migrations
└── seed.ts                 Idempotent user seed (bcrypt)

test/
├── *.e2e-spec.ts           5 suites, 45 tests (Supertest -> real Postgres)
├── env.ts, global-setup.ts Wire tests to postgres_test DB
└── helpers/                createTestApp, resetLeads, login
```

**Two guards run on every request in this order:**

1. `JwtAuthGuard` — validates the bearer token, re-fetches the user from DB so
   role changes / deactivation take effect immediately. `@Public()` opts a route
   out (used on `POST /auth/login` and Swagger UI).
2. `RolesGuard` — reads `@Roles(...)` metadata and rejects with `403 FORBIDDEN`
   if the actor's role isn't listed.

**Per-lead authorization** happens in the service layer via `LeadAccessPolicy`
and the state machine's `ASSIGNED_AGENT` actor constraint. Coarse role gating +
fine-grained per-lead checks are separated deliberately.

---

## Workflow / state machine

```text
              NEW
               │  pickup                    (LG / LGS)
               ▼
    LEAD_GENERATION_FOLLOW_UP
       │                    │
qualify│                    │ not-qualified   (LG / LGS)
       ▼                    ▼
  QUALIFIED           NOT_QUALIFIED  (terminal)
       │
       ▼   (atomic — same tx)
PENDING_AGENT_ASSIGNMENT
       │
       │  assign                             (AGENT_SUPERVISOR)
       ▼
  AGENT_ASSIGNED  ──┐
       │            │  assign again = REASSIGN
       │            │  (self-loop, emits AGENT_REASSIGNED)
       │            ▼
       │       AGENT_ASSIGNED
       │
       │  convert  (assigned AGENT only)         drop  (assigned AGENT only)
       ▼                                          ▼
CONVERTED_PENDING_APPROVAL              DROPPED_PENDING_APPROVAL
       │                                          │
       │  approve  (LG_SUPERVISOR)                │  approve  (LG_SUPERVISOR)
       ▼                                          ▼
     CLOSED                                    CLOSED
```

Everything above lives in **one** file: `src/leads/state-machine/transitions.ts`.
The `LeadStateMachine.assertTransition(from, to, actor, lead)` method runs
reachability + role + ASSIGNED_AGENT checks against that table and throws:

- `InvalidTransitionError` → HTTP **409 `INVALID_TRANSITION`** with `{ from, to }`
- `LeadNotAccessibleError` → HTTP **403 `LEAD_NOT_ACCESSIBLE`** with the reason

Every controller path that mutates a lead goes through `assertTransition` before
touching the database. State change + audit event are always written in the same
`prisma.$transaction` — either both persist or neither does.

---

## Database schema

Three tables, driven by `prisma/schema.prisma`:

**`User`** — `id`, `email`, `passwordHash`, `name`, `role`, `isActive`, `createdAt`.
`role` uses the `Role` enum. Indexed on `role`.

**`Lead`** — full domain fields (`name`, `phone`, `whatsappNumber`, `email`,
`source`, `campaign`, `interestedLocation`, `propertyType`, `bedrooms`,
`budgetFrom`, `budgetTo`, `movingDate`, `priority`), plus workflow columns
(`status`, `assignedAgentId`, `createdByUserId`, `qualificationComment`,
`notQualifiedReason`, `notQualifiedComment`, `convertedPropertyId`,
`convertedUnitId`, `convertedComment`, `droppedReason`, `droppedComment`),
`createdAt`/`updatedAt`. Indexed on `status`, `assignedAgentId`, and each of
the three duplicate-detection columns.

`source` is **immutable** — no DTO or service ever writes it after creation.
Verified by an e2e test.

**`LeadEvent`** — `id`, `leadId`, `type`, `performedByUserId`, `occurredAt`,
`metadata` (`jsonb`), `comment`. `onDelete: Restrict` on the `Lead` relation
so timeline history is retained forever, including after `CLOSED`. Indexed on
`(leadId, occurredAt)` for chronological reads.

Enums (all in `schema.prisma`): `Role`, `LeadSource`, `LeadStatus`,
`PropertyType`, `Priority`, `NotQualifiedReason`, `DroppedReason`,
`LeadEventType`.

---

## API overview

Full documentation at **`GET /docs`** (Swagger UI, generated from decorators).

| Method | Path                          | Allowed roles                              | Notes |
| ------ | ----------------------------- | ------------------------------------------ | ----- |
| `POST` | `/auth/login`                 | public                                     | Returns `{ accessToken }` |
| `GET`  | `/auth/me`                    | any authenticated                          | Returns the caller |
| `POST` | `/leads`                      | `LEAD_GENERATION`, `LG_SUPERVISOR`         | Body may include `confirmDuplicate:true` |
| `GET`  | `/leads`                      | any authenticated                          | Visibility-filtered; `?status`, `?assignedAgentId`; hard `take:100` |
| `GET`  | `/leads/:id`                  | any authenticated                          | Returns 404 (not 403) if not visible |
| `POST` | `/leads/:id/pickup`           | `LEAD_GENERATION`, `LG_SUPERVISOR`         | `NEW → LEAD_GENERATION_FOLLOW_UP` |
| `POST` | `/leads/:id/qualify`          | `LEAD_GENERATION`, `LG_SUPERVISOR`         | Atomic `LGFU → QUALIFIED → PENDING_AGENT_ASSIGNMENT` |
| `POST` | `/leads/:id/not-qualified`    | `LEAD_GENERATION`, `LG_SUPERVISOR`         | Requires `reason` enum |
| `POST` | `/leads/:id/assign`           | `AGENT_SUPERVISOR`                         | `{ agentId }`; supports reassignment |
| `POST` | `/leads/:id/convert`          | `AGENT` (assigned only)                    | `{ propertyId, unitId, comment? }` |
| `POST` | `/leads/:id/drop`             | `AGENT` (assigned only)                    | `{ reason, comment? }` |
| `POST` | `/leads/:id/approve`          | `LG_SUPERVISOR`                            | Either `*_PENDING_APPROVAL → CLOSED` |
| `GET`  | `/leads/:id/timeline`         | any authenticated (visibility-checked)     | Chronological, retained after CLOSED |

Every error response uses this shape:

```json
{ "error": { "code": "POSSIBLE_DUPLICATE", "message": "...", "details": { "existingLeadIds": [42] } } }
```

Common codes: `VALIDATION_FAILED`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`,
`POSSIBLE_DUPLICATE`, `INVALID_TRANSITION`, `LEAD_NOT_ACCESSIBLE`,
`INVALID_AGENT`.

---

## Authorization matrix

| Endpoint                   | LG | LG_SUPERVISOR | AGENT_SUPERVISOR | AGENT                                |
| -------------------------- | -- | ------------- | ---------------- | ------------------------------------ |
| `POST /leads`              | ✅ | ✅            | ❌               | ❌                                   |
| `GET /leads`               | ✅ all | ✅ all    | ✅ all           | ✅ own only                          |
| `GET /leads/:id`           | ✅ all | ✅ all    | ✅ all           | ✅ own only (404 otherwise)          |
| `POST /leads/:id/pickup`   | ✅ | ✅            | ❌               | ❌                                   |
| `POST /leads/:id/qualify`  | ✅ | ✅            | ❌               | ❌                                   |
| `POST /leads/:id/not-qualified` | ✅ | ✅       | ❌               | ❌                                   |
| `POST /leads/:id/assign`   | ❌ | ❌            | ✅               | ❌                                   |
| `POST /leads/:id/convert`  | ❌ | ❌            | ❌               | ✅ **assigned only** (403 otherwise) |
| `POST /leads/:id/drop`     | ❌ | ❌            | ❌               | ✅ **assigned only** (403 otherwise) |
| `POST /leads/:id/approve`  | ❌ | ✅            | ❌               | ❌                                   |
| `GET /leads/:id/timeline`  | ✅ all | ✅ all    | ✅ all           | ✅ own only (404 otherwise)          |

---

## Running tests

```bash
npm test              # 32 unit tests (state machine truth table)
npm run test:e2e      # 45 e2e tests (Supertest -> real Postgres)
```

E2E tests use the separate `postgres_test` service (compose port 5433) and are
completely isolated from the dev DB. Migrations + seed run once via
`global-setup`; each spec truncates `Lead` and `LeadEvent` between tests but
reuses the seeded users.

The six scenarios explicitly named in the spec are all covered:

| Spec requirement                                | Where                                           |
| ----------------------------------------------- | ----------------------------------------------- |
| Successful lead qualification                   | `leads-workflow.e2e-spec.ts` (happy paths)      |
| Agent assignment                                | `leads-workflow.e2e-spec.ts` + reassignment     |
| Invalid workflow transition                     | `lead-state-machine.spec.ts` (unit, 20 cases) + `leads-workflow.e2e-spec.ts` |
| Agent attempting to access another agent's lead | `leads-access.e2e-spec.ts` + `timeline.e2e-spec.ts` |
| Duplicate lead detection                        | `leads-create.e2e-spec.ts` (phone/email/whatsapp + bypass) |
| Timeline / audit event creation                 | `timeline.e2e-spec.ts` (both CONVERT and DROP paths) |

---

## Assumptions

Documented decisions made where the spec was silent or ambiguous. All are
enforced in code and covered by tests.

- **`source` is immutable after creation.** No DTO or service path updates it.
  Verified by an e2e test that attempts to sneak `source` through the qualify
  DTO and confirms the DB is unchanged.
- **`qualify` is atomic through `QUALIFIED`.** The workflow diagram lists
  `QUALIFIED → PENDING_AGENT_ASSIGNMENT` as a separate hop; both state-machine
  assertions run inside one `prisma.$transaction`, and both audit events
  (`LEAD_QUALIFIED` and `PENDING_AGENT_ASSIGNMENT`) are emitted, but the lead
  never persists in `QUALIFIED` — it moves straight to `PENDING_AGENT_ASSIGNMENT`.
- **Agent reassignment is allowed.** `AGENT_SUPERVISOR` calling `/assign` on an
  `AGENT_ASSIGNED` lead re-invokes the state-machine self-loop; a distinct
  `AGENT_REASSIGNED` event records `{ agentId, previousAgentId }`. Real-world
  need (agents go on leave, take vacation).
- **Approval is one-way.** `LG_SUPERVISOR` can approve; there is no
  "reject the outcome" path. Out of scope for the 48-hour brief.
- **`NOT_QUALIFIED` is terminal and distinct from `CLOSED`.** History is
  retained forever regardless.
- **Duplicate detection matches exact `phone`, exact `whatsappNumber`, and
  case-insensitive `email`.** Cross-field matching (e.g. new.phone against
  existing.whatsappNumber) is not attempted.
- **Cross-agent single-lead reads return 404, not 403.** An `AGENT` trying to
  `GET /leads/<other-agent's-id>` gets the same shape as "lead doesn't exist"
  so IDs can't be enumerated from status codes.
- **Bearer token is re-validated against the DB on every request.** The
  `JwtStrategy.validate` step re-fetches the user so role changes and `isActive`
  flips take effect without waiting for the token to expire.
- **`GET /leads` filters are AND-ed with visibility scope.** An `AGENT`
  filtering `?assignedAgentId=<other-agent>` gets `[]`, never a leak.
- **`INVALID_AGENT` at `/assign`.** `agentId` must resolve to an active user
  with role `AGENT` (400 otherwise). LG/LGS/AGENT_SUPERVISOR are rejected.

---

## Technical decisions

- **NestJS** — modules match domain boundaries; Guards + DI + class-validator
  cover authz + validation + testability with zero boilerplate. Directly earns
  the eval rubric's architecture, authz, and testing lines.
- **Prisma** — first-class migrations, strong types, and interactive
  transactions so state + audit are always atomic. Interactive-tx timeout
  bumped to 10s in `PrismaService` to avoid CI flakiness.
- **State machine as a first-class module.** All (from, to, role, actor)
  rules live in `transitions.ts`; `LeadStateMachine.assertTransition` is the
  only enforcement point. Adding a state or changing a role is a one-file
  change, and the unit test's truth table catches regressions.
- **Transactional audit via `TimelineService.record(tx, event)`.** The service
  never opens its own transaction — it writes inside the caller's. This makes
  it impossible to persist a state change without its audit event.
- **`LeadAccessPolicy` in a small leaf module (`LeadAccessModule`).** Both
  `LeadsModule` and `TimelineModule` inject the policy without importing each
  other (would cycle). Visibility is applied at the SQL level for lists
  (`filterForList`) and at the service level for single reads (`assertCanView`).
- **Separate `postgres_test` service in `docker-compose.yml`.** Windows-friendly
  (no testcontainers dependency zoo); the reviewer already has to run
  `docker compose up` — nothing else to install.
- **`tsx` as a runtime dep** (~1MB) so the shipped Docker image can execute
  `npx prisma db seed` on startup without needing full TypeScript at runtime.

---

## Trade-offs made for the 48-hour budget

- **No CI pipeline.** GitHub Actions running lint + tests + build would be
  ~1 hour of work; explicitly scoped out.
- **No rate limiting or request logging.** Would ship for production; not
  meaningful in a demo.
- **No refresh tokens.** Access tokens live for 1 day (configurable). Refresh
  is out of scope for a small backend evaluation.
- **Hard `take:100` on `GET /leads`.** No cursor pagination. Adequate for the
  demo scale.
- **Duplicate-check race window.** The dedup check runs before the insert
  inside the same tx (READ COMMITTED); two concurrent creates with the same
  phone can both pass. Documented; production would use `SELECT FOR UPDATE`
  on a lookup key, an outbox pattern, or a partial unique index.
- **Approval is one-way** (no reject path). Documented.
- **No property/unit validation on `/convert`.** `propertyId` and `unitId` are
  accepted as positive ints; the referenced entities are out of scope.
- **E2E tests written after the code, not TDD-style.** The plan batched them
  into a single phase for reviewer clarity of history. Every negative path
  is covered.

---

## What I'd change for production

- **Outbox pattern** for downstream integrations (email, WhatsApp, Zoom
  contact-center, analytics) — write to an outbox table inside the same tx as
  the state change, drain asynchronously.
- **Cursor-based pagination** on `GET /leads` + filters for date ranges,
  assigned agent, campaign, source.
- **Rejection flow** for `LG_SUPERVISOR` on `*_PENDING_APPROVAL` — send the
  lead back to the agent with a reason.
- **Soft-delete** with an `archivedAt` column instead of hard delete (never
  supported today).
- **Refresh tokens** and short-lived access tokens; token rotation on refresh.
- **Structured logging (pino) + Prometheus metrics + OpenTelemetry traces.**
- **Rate limiting** (per-user + per-IP) via a `@nestjs/throttler` or edge layer.
- **Property/unit reference validation** on convert (foreign keys or a
  service call to a property catalog).
- **Automatic agent assignment** (round-robin, workload-balanced, or by
  region) as an optional strategy behind `POST /leads/:id/assign?auto=true`.
- **DB-level uniqueness or advisory locks** to close the duplicate-check race.
- **CI pipeline** (lint, typecheck, unit, e2e against ephemeral Postgres,
  build the Docker image, publish to registry).

---

## Project structure

```
real-estate-api/
├── src/                       Application source
├── prisma/                    Schema, migrations, seed
├── test/                      E2E specs + helpers
├── Dockerfile                 Multi-stage, non-root user
├── docker-compose.yml         app + postgres (5432) + postgres_test (5433)
├── docker-compose.override.yml.example
├── .env.example
├── package.json
├── tsconfig.json / .build.json
└── README.md                  ← you are here
```

Total: 32 unit tests + 45 e2e tests = **77 automated tests**, all green.
