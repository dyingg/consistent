# Realtime

## Architecture

```
Client (Socket.IO) → API (NestJS Gateway) → Redis Pub/Sub → Other API instances
                                           → Postgres LISTEN/NOTIFY (for DB events)
```

## Components

### Socket.IO Gateway (`apps/api/src/realtime/realtime.gateway.ts`)

Handles WebSocket connections. Currently has a single `ping` → `pong` demo event.

### Auth Adapter (`apps/api/src/realtime/realtime.adapter.ts`)

Custom `IoAdapter` that authenticates WebSocket connections using Better Auth session cookies from the handshake.

### Postgres Listener (`apps/api/src/realtime/pg-listener.service.ts`)

Dedicated `pg` client (separate from Drizzle's pool) that listens on the `realtime_events` Postgres channel.

To send events from SQL:
```sql
SELECT pg_notify('realtime_events', '{"type":"example","data":"hello"}');
```

### Redis Pub/Sub (`apps/api/src/realtime/redis-pubsub.service.ts`)

Two Redis connections (subscriber + publisher) for cross-instance event fan-out.

## Adding a New Event

1. Define the event schema in `packages/realtime/src/events.ts`
2. Add a `@SubscribeMessage()` handler in the gateway
3. On the client, listen with `socket.on("eventName", callback)`

## Demo

```bash
pnpm realtime:demo
```

This signs up a test user, connects via Socket.IO with the session cookie, sends `ping`, and asserts the `pong` response.
