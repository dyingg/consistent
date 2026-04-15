# Local Development

## Prerequisites

- Node.js 24+ (see `.nvmrc`)
- pnpm 10+
- Docker (for Postgres + Redis)

## Setup

```bash
pnpm install
docker compose up -d
cp .env.example .env
# Edit .env: set BETTER_AUTH_SECRET to a real 32+ char string
pnpm db:migrate
pnpm build
```

## Development

```bash
# Start both apps
pnpm dev

# Or individually
pnpm --filter @consistent/api dev
pnpm --filter @consistent/web dev
```

- API: http://localhost:3001
- Web: http://localhost:3000

## Smoke Test

```bash
pnpm install
docker compose up -d
pnpm db:migrate
pnpm build

# Start API in background
set -a && source .env && set +a && node apps/api/dist/main.js &
API_PID=$!
sleep 5

# Health check
curl -fsS http://localhost:3001/v1/health
# expected: {"status":"ok","db":"ok","redis":"ok"}

# Start web
pnpm --filter @consistent/web dev &
WEB_PID=$!
sleep 5

# E2E tests
pnpm e2e

# Realtime plumbing
pnpm realtime:demo

# Cleanup
kill $API_PID $WEB_PID

# Static checks
pnpm typecheck
pnpm test
```

## Database

```bash
pnpm db:generate   # Generate migration from schema changes
pnpm db:migrate    # Apply migrations
pnpm db:studio     # Open Drizzle Studio
```

## Docker

```bash
docker compose up -d     # Start Postgres + Redis
docker compose down      # Stop
docker compose down -v   # Stop and remove volumes
```
