# Consistent

## Project Overview

TypeScript monorepo with two independently deployable applications:

- **`apps/web`** — Next.js 16.2 frontend (deploys to Vercel)
- **`apps/api`** — NestJS 11 backend with Express (deploys to Fly.io/Railway)

Shared packages in `packages/` provide the stability boundary. The apps communicate via HTTP and WebSocket at runtime but share types and contracts at build time.

Working email + password auth via Better Auth. Domain data model includes goals, tasks (with DAG dependencies), scheduling blocks, and LLM audit logging. Denormalized counters and database triggers maintain consistency.

## Tech Stack

| Layer               | Technology                                         | Version          |
| ------------------- | -------------------------------------------------- | ---------------- |
| Package manager     | pnpm                                               | 10.33.0          |
| Build orchestration | Turborepo                                          | 2.9.6            |
| Frontend            | Next.js (App Router, Turbopack)                    | 16.2.3           |
| UI framework        | React                                              | 19.2.4           |
| Styling             | Tailwind CSS v4 + shadcn/ui v4                     | 4.2.2            |
| Backend             | NestJS + Express adapter                           | 11.1.19          |
| Backend compiler    | SWC (via NestJS CLI)                               | —                |
| Database            | PostgreSQL 16 via Drizzle ORM                      | 0.45.2           |
| Auth                | Better Auth                                        | 1.6.3            |
| API contracts       | ts-rest + Zod                                      | 3.52.1 / 3.25.76 |
| Realtime            | Socket.IO + Postgres LISTEN/NOTIFY + Redis pub/sub | 4.8.3            |
| Env validation      | @t3-oss/env                                        | 0.13.11          |
| Schema validation   | drizzle-zod + Zod                                  | 0.8.3 / 3.25.76  |
| Testing             | Playwright (e2e), Jest + ts-jest (unit)            | 1.59.1 / 29.x    |
| Formatting          | Biome                                              | 2.4.12           |
| TypeScript          |                                                    | 5.7.3            |
| Node.js             |                                                    | 24+              |

## Repository Structure

```
apps/
  api/                          # NestJS 11 + Express
    src/
      main.ts                   # Bootstrap, mounts Better Auth on Express
      app.module.ts             # Root module (imports DrizzleModule + all domain modules)
      env.ts                    # @t3-oss/env-core validation
      db/
        types.ts                # DRIZZLE symbol + DrizzleDB type
        drizzle.provider.ts     # Factory provider (Pool + drizzle)
        drizzle.module.ts       # @Global() DrizzleModule
        index.ts                # Barrel export
      auth/
        auth.guard.ts           # Better Auth session guard
        auth.decorator.ts       # @CurrentUser() param decorator
        me.controller.ts        # GET /v1/me (protected)
      health/
        health.controller.ts    # GET /v1/health (db + redis ping, uses DRIZZLE DI)
        version.controller.ts   # GET /v1/version
      users/
        users.repository.ts     # Wraps Better Auth user table
        users.repository.spec.ts
        users.module.ts
      goals/
        goals.controller.ts     # CRUD + progress endpoints (POST/GET/PATCH/DELETE /v1/goals)
        goals.service.ts        # Ownership checks, validation, status transitions
        goals.service.spec.ts
        goals.repository.ts     # CRUD + getProgress() from denormalized columns
        goals.repository.spec.ts
        goals.module.ts
      tasks/
        tasks.controller.ts     # CRUD + bulk create, DAG, ready, dependencies (/v1/goals/:id/tasks, /v1/tasks)
        tasks.service.ts        # Ownership, bulk create in tx, dependency validation
        tasks.service.spec.ts
        tasks.repository.ts     # CRUD + findReadyForUser() + getGoalDag()
        tasks.repository.spec.ts
        dependencies.repository.ts  # DAG edge CRUD, catches cycle errors
        dependencies.repository.spec.ts
        tasks.module.ts
      scheduling/
        scheduling.controller.ts    # Block CRUD + now (POST/GET/PATCH/DELETE /v1/schedule/blocks, GET /v1/schedule/now)
        scheduling.service.ts       # Date range validation, task ownership, getCurrentBlock, realtime emission
        scheduling.service.spec.ts
        scheduling.repository.ts    # Schedule runs + blocks + joined queries (blocks with task/goal)
        scheduling.repository.spec.ts
        scheduling.module.ts
      realtime/
        realtime.gateway.ts     # Socket.IO gateway (user rooms, broadcastToUser, ping/pong)
        realtime.adapter.ts     # Custom IoAdapter with session auth
        pg-listener.service.ts  # Postgres LISTEN/NOTIFY
        redis-pubsub.service.ts # Redis pub/sub fan-out
    Dockerfile                  # Multi-stage with turbo prune
  web/                          # Next.js 16.2
    src/
      app/
        (auth)/sign-in/page.tsx
        (auth)/sign-up/page.tsx
        (app)/page.tsx          # Dashboard: goals, now, today, schedule, assistant (live data)
        layout.tsx
      lib/
        auth-client.ts          # Better Auth React client
        query-provider.tsx      # TanStack Query
        api-client.ts           # Fetch wrapper for API with credentials
        socket.ts               # Socket.IO client singleton
        use-realtime.ts         # Hook: WS events → React Query invalidation
      components/ui/            # shadcn/ui components
    e2e/auth.spec.ts            # Playwright e2e
packages/
  auth/                         # Better Auth shared config + Drizzle adapter
  contracts/                    # ts-rest + Zod contracts (health, goals, schedule)
  db/                           # Drizzle schema + migrations
    src/
      schema/
        auth.ts                 # user (+ timezone, preferences), session, account, verification
        goals.schema.ts         # goals table + goal_status enum
        tasks.schema.ts         # tasks table + task_status enum
        task-dependencies.schema.ts  # DAG edges + dependency_type enum
        schedule-runs.schema.ts # LLM audit log
        scheduled-blocks.schema.ts   # Calendar blocks + block_status, scheduled_by enums
        zod.ts                  # drizzle-zod insert/select schemas for all tables
        index.ts                # Barrel re-export
      seed.ts                   # Seed script (1 user, 2 goals, 8 tasks, 5 deps)
    drizzle/                    # Generated + custom SQL migrations
  realtime/                     # Event types (goal:updated, task:updated, schedule:updated) + channel constants
  typescript-config/            # Shared tsconfig bases
tooling/
  eslint-config/                # ESLint 10 flat configs
scripts/
  realtime-demo.ts              # Headless ping/pong test
docs/                           # Detailed documentation
docker-compose.yml              # Postgres 16 + Redis 7
```

## Common Commands

### Setup

```bash
pnpm install
docker compose up -d
cp .env.example .env            # Set BETTER_AUTH_SECRET
pnpm db:migrate
pnpm build
```

### Development

```bash
pnpm dev                        # Start all apps
pnpm --filter @consistent/api dev
pnpm --filter @consistent/web dev
```

### Build

```bash
pnpm build                      # Build all packages + apps
turbo prune @consistent/api --docker  # Prune for API Docker build
```

### Test

```bash
pnpm test                       # Unit tests (Jest for API)
pnpm --filter @consistent/api test  # API unit tests (repositories + services)
pnpm e2e                        # Playwright e2e (starts servers)
pnpm realtime:demo              # Socket.IO ping/pong test
pnpm typecheck                  # TypeScript checks
```

### Database

```bash
pnpm db:generate                # Generate migration from schema changes
pnpm db:generate:custom         # Create empty custom migration (triggers, functions)
pnpm db:migrate                 # Apply pending migrations
pnpm db:seed                    # Seed with sample data (1 user, 2 goals, 8 tasks)
pnpm db:studio                  # Open Drizzle Studio GUI
```

Note: `db:migrate` requires `DATABASE_URL` env var. If running via turbo fails, use:

```bash
cd packages/db && env $(cat ../../.env | grep -v '^#' | xargs) npx drizzle-kit migrate
```

### Formatting

```bash
pnpm format                     # Biome format
pnpm format:check               # Check without writing
```

## Domain Data Model

### Tables (in `packages/db/src/schema/`)

| Table               | PK                              | Description                                                                     |
| ------------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| `user`              | text                            | Better Auth user + `timezone`, `preferences` (JSONB typed as `UserPreferences`) |
| `goals`             | bigserial (number)              | User goals with denormalized `totalTasks`/`completedTasks` counters             |
| `tasks`             | bigserial (number)              | Tasks within goals, with `blockerCount` (denormalized)                          |
| `task_dependencies` | composite (taskId, dependsOnId) | DAG edges — `(A, B)` means "A depends on B"                                     |
| `schedule_runs`     | bigserial (number)              | LLM scheduling audit log                                                        |
| `scheduled_blocks`  | bigserial (number)              | Calendar time blocks for tasks                                                  |

### Column conventions

- Domain PKs: `bigserial('id', { mode: 'number' })`
- Domain FKs to other domain tables: `bigint('col', { mode: 'number' }).references(() => table.id, { onDelete: 'cascade' })`
- User FKs: `text('user_id').references(() => user.id, { onDelete: 'cascade' })` (text, matches auth user.id)
- Timestamps: `timestamp('col', { withTimezone: true }).notNull().defaultNow()`
- Status fields: always `pgEnum`, never `text()` with CHECK
- JSONB: `jsonb('col').$type<Interface>()`

### Database triggers (custom SQL in `drizzle/0002_triggers_and_functions.sql`)

- **`update_goal_counters`** — maintains `goals.total_tasks`/`completed_tasks` on task INSERT/UPDATE/DELETE
- **`update_blocker_counts`** — adjusts `tasks.blocker_count` when dependency edges are added/removed
- **`cascade_blocker_count`** — when a task completes/uncompletes, cascades to dependents' blocker counts
- **`prevent_cycle`** — BEFORE INSERT on `task_dependencies`, uses recursive CTE to detect cycles. Raises `check_violation` (code 23514)
- **`set_updated_at`** — auto-updates `updated_at` on tasks (only table with that column)
- **`reconcile_counters()`** — repair function that recomputes all denormalized counters from source-of-truth

### Key rules

- **Never use `COUNT(*)` for goal progress** — read `goals.totalTasks`/`completedTasks` directly
- **Cycle detection is in the DB trigger**, not application code (TOCTOU-safe under concurrent inserts)
- **Partial index** `idx_tasks_ready` on `tasks(user_id) WHERE blocker_count = 0 AND status = 'pending'` — used by `findReadyForUser()`
- Custom migrations (triggers, functions, partial index) are **not auto-regenerated** by `drizzle-kit generate` — edit by hand

## NestJS Module Architecture

### DrizzleModule (`apps/api/src/db/`)

- `@Global()` module providing `DRIZZLE` Symbol token
- Factory creates a `pg.Pool` + `drizzle(pool, { schema })` using `env.DATABASE_URL`
- All repositories inject via `@Inject(DRIZZLE) private readonly db: DrizzleDB`

### Repository pattern

- One repository per domain: `UsersRepository`, `GoalsRepository`, `TasksRepository`, `DependenciesRepository`, `SchedulingRepository`
- Repositories only return data and accept inserts/updates — **no business logic**
- Use `typeof table.$inferInsert` / `$inferSelect` for entity types
- `DependenciesRepository.create()` catches Postgres cycle error → throws `BadRequestException`

### Service layer

- One service per domain: `GoalsService`, `TasksService`, `SchedulingService`
- Services wrap repositories with business logic: ownership verification, input validation, status transitions
- `GoalsService` — title validation, `completedAt` management on status changes, computed `progress` in `findAll()`, emits `goal:updated`
- `TasksService` — bulk create in a transaction with index-based dependency mapping, goal/task ownership checks, DAG operations, emits `task:updated` + `goal:updated`
- `SchedulingService` — date range validation, task ownership for block creation, joined queries (blocks + task + goal), `getCurrentBlock()` for "now", emits `schedule:updated`
- Controllers delegate to services; services delegate to repositories

### Controllers

- `GoalsController` — `POST/GET/PATCH/DELETE /v1/goals`, `GET /v1/goals/:id/progress`
- `TasksController` — `POST/GET /v1/goals/:goalId/tasks`, `POST /v1/goals/:goalId/tasks/bulk`, `GET /v1/goals/:goalId/dag`, `GET /v1/tasks/ready`, `GET/PATCH/DELETE /v1/tasks/:id`, `POST/DELETE /v1/tasks/:id/dependencies`
- `SchedulingController` — `POST/GET/PATCH/DELETE /v1/schedule/blocks`, `GET /v1/schedule/now`
- All domain controllers use `@UseGuards(AuthGuard)` and `@CurrentUser()` decorator

## Architectural Decisions

- **Express over Fastify** — broader middleware ecosystem (e.g., Mastra adapter), simpler raw route mounting
- **Drizzle over Prisma** — SQL-like API, no code generation step, lighter
- **Better Auth over NextAuth** — framework-agnostic, works with any backend, simpler session model
- **Database sessions over JWT** — revocable, no token size issues, simpler security model
- **ts-rest over tRPC/GraphQL** — REST-native with type safety, works across independent deployments
- **Better Auth outside ts-rest** — Better Auth owns its own routing at `/api/auth/*`, not under `/v1/`
- **LISTEN/NOTIFY over Supabase Realtime** — no vendor lock-in, works with any Postgres
- **pnpm over npm/yarn/bun** — strict dependency resolution, workspace protocol, fast
- **URL versioning on API** — all routes under `/v1/`, clear API evolution path
- **SWC builder for NestJS** — avoids ESM/CJS interop issues with `moduleResolution: "bundler"`, faster builds
- **Denormalized counters over COUNT queries** — `goals.totalTasks`/`completedTasks` and `tasks.blockerCount` maintained by triggers for O(1) reads
- **DB-level cycle detection** — recursive CTE trigger prevents DAG cycles, TOCTOU-safe vs application-level checks
- **Repository pattern over direct DB access** — repositories encapsulate all Drizzle queries, injected via NestJS DI

## Auth Flow

1. User fills sign-up/sign-in form at `apps/web`
2. Better Auth React client POSTs to `http://API_URL/api/auth/sign-up/email`
3. Raw Express route in `apps/api/src/main.ts` catches `/api/auth/*`, constructs a Web `Request`, forwards to `auth.handler()`
4. Better Auth validates credentials, creates user + session in Postgres via Drizzle adapter
5. Response includes `Set-Cookie` with `httpOnly` session token
6. Browser stores cookie, sends it on subsequent requests
7. `AuthGuard` calls `auth.api.getSession({ headers: fromNodeHeaders(req.headers) })` to validate
8. `@CurrentUser()` decorator extracts user from `req.user`

## Realtime Architecture

Services emit lightweight WebSocket events after mutations. The frontend invalidates React Query caches on receipt, triggering a refetch — no full entity sync over WebSocket.

### Flow

1. Service mutates DB (e.g., `TasksService.update()`)
2. Service calls `this.realtime.broadcastToUser(userId, EVENTS.TASK_UPDATED, { taskId, goalId })`
3. Gateway emits to `user:<userId>` Socket.IO room
4. Frontend `useRealtime()` hook receives event → calls `queryClient.invalidateQueries()`
5. React Query refetches the affected endpoint(s)

### Events (defined in `packages/realtime/src/events.ts`)

| Event              | Emitted by                 | Payload              | Invalidates                 |
| ------------------ | -------------------------- | -------------------- | --------------------------- |
| `goal:updated`     | GoalsService, TasksService | `{ goalId }`         | `["goals"]`                 |
| `task:updated`     | TasksService               | `{ taskId, goalId }` | `["goals"]`, `["schedule"]` |
| `schedule:updated` | SchedulingService          | `{ blockId? }`       | `["schedule"]`              |

### Key patterns

- `RealtimeGateway.broadcastToUser(userId, event, payload)` — scoped to user's room, no cross-user leaks
- `RealtimeModule` is exported and imported by GoalsModule, TasksModule, SchedulingModule
- Socket.IO client (`apps/web/src/lib/socket.ts`) uses `withCredentials: true` for session cookie auth
- PG LISTEN/NOTIFY and Redis pub/sub are scaffolded but not yet wired for domain events (available for multi-instance scaling)

### Client state: the cache is the only source of truth

The flow above (event → invalidate → refetch → cache update → re-render) **only works if every UI surface reads server data directly from the React Query cache**. Layering component-local `useState` or `Record<id, boolean>` override maps on top of cached data silently breaks realtime: the invalidation updates the cache, but the component ignores it and keeps rendering the stale local copy. The same bug manifests when two components both touch the same task — whichever one layered local state will desync from the other. Page reload "fixes" it because local state resets; cache re-derives from the server.

**Rule**: if a value mirrors server state (task status, goal progress, schedule block fields), it lives only in the query cache. Never mirrored into `useState`.

**When you need optimistic UI**, use TanStack Query's `onMutate` pattern — cancel in-flight refetches, snapshot the cache, write the optimistic value to the cache, return the snapshot for `onError` rollback, invalidate in `onSettled`. Every subscriber of that key sees the optimistic value instantly and realtime events still flow through. Reference: `useToggleTaskStatus` in `apps/web/src/app/(app)/page.tsx`.

**Local state is fine for non-server data**: animation flags (`justTapped`), UI toggles (`isExpanded`), focus indices, hover state, scroll position. Name these so the non-mirror intent is obvious — if you're about to write `useState<boolean>` for a value called `completed` or `taskStatus`, stop and use the cache.

## API Endpoints

### Auth (Better Auth — outside `/v1/`)

- `POST /api/auth/sign-up/email` — Register
- `POST /api/auth/sign-in/email` — Login
- `GET /api/auth/session` — Get session

### Health

- `GET /v1/health` — DB + Redis health check
- `GET /v1/version` — API version

### User

- `GET /v1/me` — Authenticated user info

### Goals (all protected)

- `GET /v1/goals?status=` — List goals with computed `progress` percentage
- `POST /v1/goals` — Create goal
- `GET /v1/goals/:id` — Get goal
- `PATCH /v1/goals/:id` — Update goal
- `DELETE /v1/goals/:id` — Delete goal
- `GET /v1/goals/:id/progress` — Get denormalized progress counters

### Tasks (all protected)

- `POST /v1/goals/:goalId/tasks` — Create task
- `POST /v1/goals/:goalId/tasks/bulk` — Bulk create tasks with dependencies
- `GET /v1/goals/:goalId/tasks` — List tasks for goal
- `GET /v1/goals/:goalId/dag` — Get goal DAG (recursive CTE)
- `GET /v1/tasks/ready` — Find unblocked pending tasks
- `GET /v1/tasks/:id` — Get task
- `PATCH /v1/tasks/:id` — Update task (status, title, etc.)
- `DELETE /v1/tasks/:id` — Delete task
- `POST /v1/tasks/:id/dependencies` — Add dependency edge
- `DELETE /v1/tasks/:id/dependencies/:dependsOnId` — Remove dependency edge

### Scheduling (all protected)

- `POST /v1/schedule/blocks` — Create scheduled block
- `GET /v1/schedule/blocks?start=&end=` — Get blocks in range (joined with task + goal)
- `GET /v1/schedule/now` — Get currently active block (joined with task + goal)
- `PATCH /v1/schedule/blocks/:id` — Update block status
- `DELETE /v1/schedule/blocks/:id` — Delete block

### AI Assistant

- `POST /chat/:agentId` — Streaming chat endpoint (mounted by Mastra, not under `/v1/`). Session cookie auth via `@mastra/auth-better-auth`. An Express middleware injects `memory: { resource, thread }` server-side so clients cannot target another user's thread. Agent id is `consistent-coach`.
- `GET /v1/ai/threads/:threadId/messages` — Protected (`AuthGuard`). Enforces `threadId` ownership via `buildThreadId(userId)`. Returns Mastra-persisted thread messages in assistant-ui shape.

## AI Module (`apps/core/src/ai/`)

- **`consistent-coach` agent** — mentor-coach persona (`prompts/coach.ts`). Interview-first flow, Fibonacci sprint-point breakdown (1/2/3/5/8/13), writes `context` on every task, confirms in text before delete.
- **Tools** — `tools/{goals,tasks,scheduling,time}.tools.ts`. Each pulls `userId` from `requestContext.get("mastra__resourceId")` (populated by `MastraAuthBetterAuth`) and delegates to the existing services, which emit realtime events for free. `delete-task` takes a `taskIds: number[]` and deletes one or many in a single call (all-or-nothing via `TasksService.bulkDelete`) — prefer it over looping delete calls.
- **Memory** — `memory.ts` creates a `Memory` backed by `PostgresStore` in schema `mastra`. `store.init()` runs at bootstrap and creates tables if missing.
- **Bootstrap** — `ai.bootstrap.ts` mounts Mastra on Express during `onApplicationBootstrap`, with the `chatMemoryGuard` middleware registered before chat routes.
- **Frontend** — `apps/web/src/components/coach/` uses `@assistant-ui/react` primitives + `useChatRuntime` + `AssistantChatTransport` pointed at `/chat/consistent-coach`. History loads via `ThreadHistoryAdapter`.

## Independent Deployment Model

- API and web are versioned and deployed separately
- `packages/contracts` is the type-level stability boundary — both apps depend on it
- At runtime, they communicate via HTTP (REST) and WebSocket (Socket.IO)
- API version bumps (e.g., `/v2/`) are independent of frontend releases
- Cross-subdomain cookies in production require matching domain config in Better Auth

## Adding New Features

### New API endpoint

1. Add Zod schema to `packages/contracts/src/v1/`
2. Create NestJS controller with `@Controller({ version: '1' })`
3. Add guard if protected: `@UseGuards(AuthGuard)`
4. Consume from web via ts-rest client or direct fetch

### New realtime event

1. Define event name in `EVENTS` const + Zod payload schema in `packages/realtime/src/events.ts`
2. Emit from the relevant service via `this.realtime.broadcastToUser(userId, EVENTS.XXX, payload)`
3. Add listener in `apps/web/src/lib/use-realtime.ts` that calls `queryClient.invalidateQueries()`

### New database table or column

1. Edit/create schema file in `packages/db/src/schema/`
2. Re-export from `packages/db/src/schema/index.ts`
3. `pnpm db:generate` to create migration SQL
4. Review generated SQL, then `pnpm db:migrate` to apply

### New trigger or database function

1. `pnpm db:generate:custom --name=description` to create empty migration
2. Write SQL in the generated file
3. `pnpm db:migrate` to apply

### New domain module (API)

1. Create directory under `apps/api/src/<domain>/`
2. Create `<domain>.repository.ts` — inject `DRIZZLE`, wrap Drizzle queries
3. Create `<domain>.service.ts` — inject repository, add business logic (validation, ownership, status transitions)
4. Create `<domain>.controller.ts` — inject service, define routes with `@Controller({ version: '1' })`, `@UseGuards(AuthGuard)`
5. Create `<domain>.module.ts` — provide repository + service + controller, export service
6. Import the module in `apps/api/src/app.module.ts`
7. Write tests in `<domain>.repository.spec.ts` and `<domain>.service.spec.ts`

### New protected route (frontend)

1. Use `useSession()` from `@/lib/auth-client` to check auth
2. Redirect to `/sign-in` if no session

### New frontend surface that reads or mutates server data

1. Read with `useQuery` under the same key already used elsewhere for the same data (e.g., `["schedule", "today"]`) — React Query dedupes, one network call serves every subscriber
2. Render directly from query data. **Do not** copy task/goal/schedule fields into `useState` or a `Record<id, boolean>` override map — that parallel store will desync from realtime invalidations and from other components' mutations (see Realtime Architecture › Client state)
3. For optimistic mutations, use or extend a shared hook that patches the query cache in `onMutate` and invalidates in `onSettled`. Example: `useToggleTaskStatus` in `apps/web/src/app/(app)/page.tsx`
4. Local `useState` is only for UI-intrinsic state (animation flags, toggles, focus, hover) — never for mirrors of server fields

## Environment Variables

### API (`apps/api`)

| Variable             | Public | Description                             |
| -------------------- | ------ | --------------------------------------- |
| `DATABASE_URL`       | No     | PostgreSQL connection string            |
| `REDIS_URL`          | No     | Redis connection string                 |
| `BETTER_AUTH_SECRET` | No     | 32+ char secret for session signing     |
| `BETTER_AUTH_URL`    | No     | Public URL of the API                   |
| `WEB_ORIGIN`         | No     | Frontend URL for CORS + trusted origins |
| `PORT`               | No     | API port (default: 3001)                |

### Web (`apps/web`)

| Variable              | Public | Description                      |
| --------------------- | ------ | -------------------------------- |
| `NEXT_PUBLIC_API_URL` | Yes    | API URL for client-side requests |

## TypeScript: no `any`

**`any` is banned in this codebase.** This includes `: any`, `as any`, `<any>`, `Array<any>`, and any other use of the explicit `any` keyword. The ESLint rule `@typescript-eslint/no-explicit-any` is set to `error` in `tooling/eslint-config/base.js` and inherited by every package — `pnpm lint` will fail.

`any` defeats the purpose of TypeScript: it silently disables every check downstream of the type, so a renamed field, a removed function, or a wrong-shape API response slips through type-checking and surfaces as a runtime crash. The body-parser bug in commit `47a955b` was masked by `(express as any).all(...)` — a properly typed Express adapter would have made it visible.

**Reach for these instead, in order:**

1. **`unknown`** — for values whose shape isn't known yet. Forces you to narrow before use.
2. **A discriminated union or proper type** — most "I don't know what this is" cases are actually "this is one of N things." Define them.
3. **Generics** — for code that's polymorphic over its input type (e.g., a chain mock).
4. **Type the third-party shape yourself** — write a narrow `type X = { ... }` for the bit you actually use, even if the library is untyped.

**The escape hatch (use rarely):**

When you genuinely cannot type something — an untyped third-party callback, a JSON.parse result you're about to validate, a deliberately polymorphic test helper — suppress per-line with a reason:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mastra registerApiRoute middleware signature is unexported
middleware: (req: any, res: any, next: any) => { ... }
```

The `-- <reason>` is required by the ESLint config. PRs that introduce `any` without a written reason should be rejected. If you're disabling the rule on more than one line in the same file, that's a smell — define a type instead.

**Related rules** (also in `tooling/eslint-config/base.js`):

- `@typescript-eslint/ban-ts-comment` — `@ts-ignore` and `@ts-nocheck` are errors. Use `@ts-expect-error` with a description (≥10 chars) when you must — it surfaces if the underlying issue is fixed.

## Gotchas

- Better Auth mounts at `/api/auth/*`, **not** under `/v1/` — it owns its own routing
- `packages/db` pg-listener uses a dedicated `pg.Client`, separate from Drizzle's pool
- WebSocket auth uses the same session cookie as REST — Socket.IO client needs `withCredentials: true`
- Cross-subdomain cookies in production need real DNS + HTTPS + `sameSite: "none"` + `secure: true`
- CORS must have `credentials: true` and an explicit origin (not `*`) for auth cookies to work
- `packages/auth` is ESM (`"type": "module"`) because `better-auth` is ESM-only
- API uses SWC builder with `moduleResolution: "bundler"` — avoids CJS/ESM interop issues
- Zod must stay at v3 — ts-rest peer dep is `^3.22.3`, incompatible with Zod 4
- TypeScript pinned to 5.7.3 — NestJS 11 doesn't support TS 6 yet
- Domain tables use `bigserial` with `mode: 'number'` (JS number), **not** `mode: 'bigint'` — avoids JSON serialization issues
- All `userId` FKs are `text` (matching auth `user.id`), not `bigint` — the auth user table was extended in place
- Custom SQL migrations (triggers, partial index, check constraints) are tracked in drizzle journal but NOT auto-regenerated — edit `drizzle/0002_triggers_and_functions.sql` by hand
- `db:migrate` via turbo may fail if `DATABASE_URL` isn't available — run directly with `env` prefix (see Database commands above)
- Jest tests for API mock the `../db` barrel to avoid importing ESM-only `@t3-oss/env-core` — see `jest` config in `apps/api/package.json` for `moduleNameMapper` and inline tsconfig
- Service specs must provide a mock `RealtimeGateway` with `{ broadcastToUser: jest.fn() }` — services inject it for event emission
- Never shadow cached server state (task status, goal progress, schedule fields) with `useState` or override maps on the web — overlays swallow realtime invalidations and desync across surfaces (see Realtime Architecture › Client state)

## What's Not Built Yet

- Goal/task management UI (CRUD forms — dashboard shows read-only data from API)
- Scheduling UI (creating/moving blocks — only API endpoints exist)
- Thread list UI for the assistant (single persistent thread per user today)
- Rate limiting on `/chat/*`
- Working memory / agent-initiated proactive messages
- Email verification / password reset (Better Auth supports it, just not enabled)
- OAuth providers
- Rate limiting on auth endpoints
- Production deployment configs (Vercel/Fly.io — workflows are scaffolded but deploy steps commented out)
- pg_cron setup for `reconcile_counters()` nightly run
- Redis pub/sub fan-out for multi-instance WebSocket scaling (infrastructure scaffolded, not wired to domain events)

## Git Commit Convention

**Atomic commits only. Commit after every logical unit of work, not at the end of a session.**

This is critical — parallel sessions may be running on the same branch. Batching changes risks merge conflicts and makes rollbacks impossible. Each commit should be self-contained and deployable.

Every commit must be:

- **Reviewable** — a reader can understand it in 5–15 minutes. If the diff is too sprawling to hold in your head, it's too big.
- **Atomic** — one logical change. Don't smuggle an unrelated rename, formatting sweep, or drive-by fix into a feature commit. Split them.
- **Buildable** — the project compiles after the commit. No "will fix in next commit" broken states. `pnpm build` (or the relevant package build) must pass.
- **Testable** — tests pass after the commit. If a test is intentionally skipped or pending, note it in the commit message (e.g. "test skipped pending fixture work in #123").
- **Revertable** — `git revert <sha>` can undo the commit without breaking unrelated features. If reverting would cascade into other commits, the boundaries are wrong.

If a change doesn't meet all five, split it. Common splits: (1) refactor first → feature on top, (2) schema/migration first → code using it next, (3) dependency bump alone → usage in a follow-up, (4) rename/move alone → behavior change after.

Examples of logical units:

- Installing a dependency → commit `package.json` + `pnpm-lock.yaml`
- Updating a theme/config → commit the config files together
- Rewriting a single page → commit that page file

List each file path explicitly:

```bash
# New files
git restore --staged :/ && git add "path/to/file1" "path/to/file2" && git commit -m "<scoped message>"

# Tracked files
git commit -m "<scoped message>" -- path/to/file1 path/to/file2
```

# IMPORTANT - ATOMIC COMMITS GIT WORKFLOW

COMMIT after every small change or unit of work is done.
Never use `git add .` or `git add -A`. Never batch multiple unrelated changes into one commit. Never wait until the end of a task to commit — commit as you go.
