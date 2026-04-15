# Consistent

TypeScript monorepo with a **Next.js 16** frontend and a **NestJS 11** backend, connected by shared packages for type-safe contracts, auth, database, and realtime.

## Prerequisites

- [Node.js](https://nodejs.org/) 24+
- [pnpm](https://pnpm.io/) 10.33+
- [Docker](https://www.docker.com/) (for Postgres and Redis)

## Getting Started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Start Postgres and Redis

```bash
docker compose up -d
```

### 3. Configure environment

```bash
cp .env.example .env
```

The defaults work out of the box with the Docker Compose services. The only value you should change for real use is `BETTER_AUTH_SECRET` — set it to a random string of at least 32 characters.

### 4. Run database migrations

```bash
pnpm db:migrate
```

### 5. Build shared packages

```bash
pnpm build
```

### 6. Start development servers

```bash
pnpm dev
```

This starts both apps concurrently:

| App | URL | Description |
|-----|-----|-------------|
| Web | http://localhost:3000 | Next.js frontend |
| API | http://localhost:3001 | NestJS backend |

## Project Structure

```
apps/
  api/       → NestJS 11 + Fastify (REST + WebSocket)
  web/       → Next.js 16 (App Router + Turbopack)
packages/
  auth/      → Better Auth shared config + Drizzle adapter
  contracts/ → ts-rest + Zod API contracts
  db/        → Drizzle ORM schema + migrations
  realtime/  → Socket.IO event types + channel constants
```

## Common Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all apps in dev mode |
| `pnpm build` | Build all packages and apps |
| `pnpm typecheck` | Run TypeScript checks across the monorepo |
| `pnpm format` | Format code with Biome |
| `pnpm test` | Run unit tests |
| `pnpm e2e` | Run Playwright end-to-end tests |
| `pnpm db:generate` | Generate a migration from schema changes |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:studio` | Open Drizzle Studio GUI |

## Environment Variables

All env vars live in a single `.env` at the monorepo root.

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `BETTER_AUTH_SECRET` | 32+ char secret for session signing |
| `BETTER_AUTH_URL` | Public URL of the API |
| `WEB_ORIGIN` | Frontend URL (used for CORS and trusted origins) |
| `NEXT_PUBLIC_API_URL` | API URL for client-side requests |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Package manager | pnpm + Turborepo |
| Frontend | Next.js 16, React 19, Tailwind CSS v4, shadcn/ui |
| Backend | NestJS 11, Fastify, SWC |
| Database | PostgreSQL 16 via Drizzle ORM |
| Auth | Better Auth (email + password, database sessions) |
| API contracts | ts-rest + Zod |
| Realtime | Socket.IO + Postgres LISTEN/NOTIFY + Redis pub/sub |
| Testing | Playwright (e2e), Vitest (unit) |
| Formatting | Biome |
