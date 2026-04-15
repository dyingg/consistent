# Deployment

## Architecture

The API and web app are deployed independently:

- **Web** (`apps/web`): Vercel
- **API** (`apps/api`): Fly.io or Railway

They share contracts via `packages/contracts` at build time but communicate via HTTP/WebSocket at runtime.

## API Deployment

### Docker

The API has a multi-stage Dockerfile at `apps/api/Dockerfile` that uses `turbo prune` to create a minimal deployment artifact:

```bash
# From repo root
docker build -f apps/api/Dockerfile -t consistent-api .
docker run -p 3001:3001 --env-file .env consistent-api
```

### Fly.io (example)

```bash
cd apps/api
flyctl launch
flyctl secrets set DATABASE_URL=... REDIS_URL=... BETTER_AUTH_SECRET=... BETTER_AUTH_URL=... WEB_ORIGIN=...
flyctl deploy
```

### Environment Variables (API)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `BETTER_AUTH_SECRET` | 32+ char secret for session signing |
| `BETTER_AUTH_URL` | Public URL of the API (for Better Auth) |
| `WEB_ORIGIN` | Frontend URL (for CORS + trusted origins) |
| `PORT` | API port (default: 3001) |

## Web Deployment

Vercel auto-detects Next.js. Set these env vars in the Vercel dashboard:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Public URL of the API |

## Cookie Domains in Production

For cross-subdomain auth (e.g., `app.example.com` + `api.example.com`), configure Better Auth with:

```typescript
cookie: {
  domain: ".example.com",
  sameSite: "none",
  secure: true,
}
```

This requires HTTPS on both domains.
