# Consistent

TypeScript monorepo with independently deployable Next.js frontend and NestJS backend.

## Quick Start

```bash
pnpm install
docker compose up -d
cp .env.example .env  # Edit BETTER_AUTH_SECRET
pnpm db:migrate
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:3001

## Documentation

- [Local Development](./local-development.md)
- [Auth](./auth.md)
- [Deployment](./deployment.md)
- [Realtime](./realtime.md)
