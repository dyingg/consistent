# Consistent

## Project Overview

TypeScript monorepo with two independently deployable applications:

- **`apps/web`** — Next.js 16.2 frontend (deploys to Vercel)
- **`apps/api`** — NestJS 11 backend with Fastify (deploys to Fly.io/Railway)

Shared packages in `packages/` provide the stability boundary. The apps communicate via HTTP and WebSocket at runtime but share types and contracts at build time.

Working email + password auth via Better Auth. No business logic beyond auth, health checks, and realtime plumbing.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Package manager | pnpm | 10.33.0 |
| Build orchestration | Turborepo | 2.9.6 |
| Frontend | Next.js (App Router, Turbopack) | 16.2.3 |
| UI framework | React | 19.2.4 |
| Styling | Tailwind CSS v4 + shadcn/ui v4 | 4.2.2 |
| Backend | NestJS + Fastify adapter | 11.1.19 |
| Backend compiler | SWC (via NestJS CLI) | — |
| Database | PostgreSQL 16 via Drizzle ORM | 0.45.2 |
| Auth | Better Auth | 1.6.3 |
| API contracts | ts-rest + Zod | 3.52.1 / 3.25.76 |
| Realtime | Socket.IO + Postgres LISTEN/NOTIFY + Redis pub/sub | 4.8.3 |
| Env validation | @t3-oss/env | 0.13.11 |
| Testing | Playwright (e2e), Vitest (unit) | 1.59.1 / — |
| Formatting | Biome | 2.4.12 |
| TypeScript | | 5.7.3 |
| Node.js | | 24+ |

## Repository Structure

```
apps/
  api/                          # NestJS 11 + Fastify
    src/
      main.ts                   # Bootstrap, mounts Better Auth on Fastify
      app.module.ts
      env.ts                    # @t3-oss/env-core validation
      auth/
        auth.guard.ts           # Better Auth session guard
        auth.decorator.ts       # @CurrentUser() param decorator
        me.controller.ts        # GET /v1/me (protected)
      health/
        health.controller.ts    # GET /v1/health (db + redis ping)
        version.controller.ts   # GET /v1/version
      realtime/
        realtime.gateway.ts     # Socket.IO gateway (ping/pong)
        realtime.adapter.ts     # Custom IoAdapter with session auth
        pg-listener.service.ts  # Postgres LISTEN/NOTIFY
        redis-pubsub.service.ts # Redis pub/sub fan-out
    Dockerfile                  # Multi-stage with turbo prune
  web/                          # Next.js 16.2
    src/
      app/
        (auth)/sign-in/page.tsx
        (auth)/sign-up/page.tsx
        (app)/page.tsx          # Home: shows user or auth links
        layout.tsx
      lib/
        auth-client.ts          # Better Auth React client
        query-provider.tsx      # TanStack Query
      components/ui/            # shadcn/ui components
    e2e/auth.spec.ts            # Playwright e2e
packages/
  auth/                         # Better Auth shared config + Drizzle adapter
  contracts/                    # ts-rest + Zod contracts (health reference)
  db/                           # Drizzle schema + migrations
    src/schema/auth.ts          # user, session, account, verification tables
    drizzle/                    # Generated SQL migrations
  realtime/                     # Event types + channel constants
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
pnpm test                       # Unit tests
pnpm e2e                        # Playwright e2e (starts servers)
pnpm realtime:demo              # Socket.IO ping/pong test
pnpm typecheck                  # TypeScript checks
```

### Database
```bash
pnpm db:generate                # Generate migration from schema changes
pnpm db:migrate                 # Apply pending migrations
pnpm db:studio                  # Open Drizzle Studio GUI
```

### Formatting
```bash
pnpm format                     # Biome format
pnpm format:check               # Check without writing
```

## Architectural Decisions

- **Fastify over Express** — faster, better TypeScript support, native async
- **Drizzle over Prisma** — SQL-like API, no code generation step, lighter
- **Better Auth over NextAuth** — framework-agnostic, works with any backend, simpler session model
- **Database sessions over JWT** — revocable, no token size issues, simpler security model
- **ts-rest over tRPC/GraphQL** — REST-native with type safety, works across independent deployments
- **Better Auth outside ts-rest** — Better Auth owns its own routing at `/api/auth/*`, not under `/v1/`
- **LISTEN/NOTIFY over Supabase Realtime** — no vendor lock-in, works with any Postgres
- **pnpm over npm/yarn/bun** — strict dependency resolution, workspace protocol, fast
- **URL versioning on API** — all routes under `/v1/`, clear API evolution path
- **SWC builder for NestJS** — avoids ESM/CJS interop issues with `moduleResolution: "bundler"`, faster builds

## Auth Flow

1. User fills sign-up/sign-in form at `apps/web`
2. Better Auth React client POSTs to `http://API_URL/api/auth/sign-up/email`
3. Raw Fastify route in `apps/api/src/main.ts` catches `/api/auth/*`, constructs a Web `Request`, forwards to `auth.handler()`
4. Better Auth validates credentials, creates user + session in Postgres via Drizzle adapter
5. Response includes `Set-Cookie` with `httpOnly` session token
6. Browser stores cookie, sends it on subsequent requests
7. `AuthGuard` calls `auth.api.getSession({ headers: fromNodeHeaders(req.headers) })` to validate
8. `@CurrentUser()` decorator extracts user from `req.user`

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
1. Define schema in `packages/realtime/src/events.ts`
2. Add `@SubscribeMessage()` handler in `realtime.gateway.ts`
3. Client listens with `socket.on("eventName", callback)`

### New database migration
1. Edit schema in `packages/db/src/schema/`
2. `pnpm db:generate` to create migration SQL
3. `pnpm db:migrate` to apply

### New protected route (frontend)
1. Use `useSession()` from `@/lib/auth-client` to check auth
2. Redirect to `/sign-in` if no session

## Environment Variables

### API (`apps/api`)
| Variable | Public | Description |
|----------|--------|-------------|
| `DATABASE_URL` | No | PostgreSQL connection string |
| `REDIS_URL` | No | Redis connection string |
| `BETTER_AUTH_SECRET` | No | 32+ char secret for session signing |
| `BETTER_AUTH_URL` | No | Public URL of the API |
| `WEB_ORIGIN` | No | Frontend URL for CORS + trusted origins |
| `PORT` | No | API port (default: 3001) |

### Web (`apps/web`)
| Variable | Public | Description |
|----------|--------|-------------|
| `NEXT_PUBLIC_API_URL` | Yes | API URL for client-side requests |

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

## What's Not Built Yet

- Business logic / data models beyond auth tables
- UI beyond sign-in, sign-up, and home page
- Email verification / password reset (Better Auth supports it, just not enabled)
- OAuth providers
- Rate limiting on auth endpoints
- Production deployment configs (Vercel/Fly.io — workflows are scaffolded but deploy steps commented out)
- Unit tests (Vitest configured but no tests written)
- API-level integration tests

## Git Commit Convention

**Atomic commits only. Commit after every logical unit of work, not at the end of a session.**

This is critical — parallel sessions may be running on the same branch. Batching changes risks merge conflicts and makes rollbacks impossible. Each commit should be self-contained and deployable.

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

Never use `git add .` or `git add -A`. Never batch multiple unrelated changes into one commit. Never wait until the end of a task to commit — commit as you go.
