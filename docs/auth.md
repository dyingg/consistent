# Auth

## How It Works

1. User submits email + password to the sign-up or sign-in form in the Next.js frontend
2. The Better Auth React client (`apps/web/src/lib/auth-client.ts`) sends a POST to `http://localhost:3001/api/auth/sign-up/email` (or `sign-in/email`)
3. The raw Fastify route in `apps/api/src/main.ts` catches `/api/auth/*` and forwards to Better Auth's handler
4. Better Auth creates/validates the user in Postgres via the Drizzle adapter, creates a session row, and returns a `Set-Cookie` header with the session token
5. The browser stores the `httpOnly` session cookie
6. Subsequent requests include the cookie. The `AuthGuard` (`apps/api/src/auth/auth.guard.ts`) calls `auth.api.getSession()` to validate it
7. Protected endpoints like `GET /v1/me` use the guard to require authentication

## Key Files

| File | Purpose |
|------|---------|
| `packages/auth/src/auth.ts` | Better Auth instance config |
| `packages/db/src/schema/auth.ts` | Drizzle schema for auth tables |
| `apps/api/src/main.ts` | Mounts Better Auth on Fastify |
| `apps/api/src/auth/auth.guard.ts` | NestJS guard for session validation |
| `apps/api/src/auth/me.controller.ts` | Protected `/v1/me` endpoint |
| `apps/web/src/lib/auth-client.ts` | Better Auth React client |

## Tables

- `user` — id, name, email, emailVerified, image, timestamps
- `session` — id, token, expiresAt, userId, ipAddress, userAgent
- `account` — id, accountId, providerId, userId, tokens, password hash
- `verification` — id, identifier, value, expiresAt (for email verification)

## Cross-Origin Setup

In development, the API runs on `:3001` and the web on `:3000`. Auth cookies work because:

- API CORS: `origin: WEB_ORIGIN, credentials: true`
- Better Auth: `trustedOrigins: [WEB_ORIGIN]`
- Better Auth client: `baseURL` points to the API
- Cookie: `sameSite: lax`, `httpOnly: true`

## Not Implemented Yet

- Email verification (Better Auth supports it, just not enabled)
- Password reset
- OAuth providers
- Rate limiting on auth endpoints
