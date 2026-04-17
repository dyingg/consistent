# Handoff: Coach thread history not loading on page reload

**Status:** open
**Date opened:** 2026-04-17
**Branch where issue was observed:** `feat/ai-assistant-coach`
**Related PR:** [#1](https://github.com/dyingg/consistent/pull/1)
**Severity:** medium — nice-to-have for MVP, but user-visible confusion

## What's working

- `POST /chat/consistent-coach` streams replies end-to-end (session auth, tool calls, markdown).
- Thread messages **are** persisting to Postgres in the `mastra` schema (confirmed: rows appear in `mastra.messages` after a turn, scoped to `assistant-${userId}`).
- Our own endpoint `GET /v1/ai/threads/:threadId/messages` is implemented at `apps/core/src/ai/ai.controller.ts` and returns shaped messages for the authenticated user.

## The gap

On page reload, the Assistant pane renders the empty state ("Ask about your goals, today, or what to do next.") instead of the prior conversation. The history adapter we wired up doesn't fire a fetch.

**Observed via Chrome DevTools Network tab after a reload**: no request to `/v1/ai/threads/...` goes out. All other dashboard requests (`/v1/goals`, `/v1/schedule/*`, `/api/auth/get-session`) fire normally.

## What the code currently does

### Frontend wiring (`apps/web/src/components/coach/coach.tsx`)

```tsx
const adapters = useMemo(
  () => ({
    history: threadId ? createHistoryAdapter(API_URL, threadId) : undefined,
  }),
  [threadId],
);

const runtime = useChatRuntime({ transport, adapters });
```

- `threadId` comes from the Better Auth session — so it's `null` on the first render and `"assistant-<userId>"` after `useSession()` resolves.
- `createHistoryAdapter` lives at `apps/web/src/components/coach/history-adapter.ts` and exposes `load()` + `append()` conforming to `ThreadHistoryAdapter` from `@assistant-ui/react`.

### Backend endpoint (`apps/core/src/ai/ai.controller.ts:22-48`)

- `GET /v1/ai/threads/:threadId/messages`
- Guarded by `AuthGuard`, enforces `isOwnedBy(threadId, user.id)` (403 otherwise).
- Reads via `this.memory.recall({ threadId, resourceId: user.id })` and maps to `{ id, role, content, createdAt }`.

## Hypotheses to check first (in priority order)

1. **`useChatRuntime` may not invoke `adapters.history.load()` automatically on mount.** The docs section we leaned on was for `useLocalRuntime`'s history adapter, which has different wiring from the AI-SDK runtime. Verify by:
   - Reading `apps/web/node_modules/@assistant-ui/react-ai-sdk/dist/*` source for where `adapters.history` is consumed.
   - If `useChatRuntime` doesn't support it, we likely need `useRemoteThreadListRuntime` (which does implement thread CRUD) or a custom initial-messages prop.

2. **Timing race on `threadId`.** On first render `threadId` is `null`, so `adapters` is built with `history: undefined`. Even if assistant-ui's runtime *would* call `load()`, it may only consult `adapters` once at mount. Confirm by logging inside `createHistoryAdapter.load` — does it ever execute?

3. **Shape mismatch.** `createHistoryAdapter` returns:
   ```ts
   { messages: [{ message: ThreadMessage, parentId: null | string }] }
   ```
   — with `metadata: { unstable_data: [], unstable_state: null, custom: {} }` and `status: { type: "complete", reason: "stop" }` synthesized per message. These shapes were guessed from the TypeScript error, not verified against a real response. If `load()` *is* called but returns a malformed shape, assistant-ui may swallow the result silently.

## Reproduction

1. `docker compose up -d && pnpm db:migrate`
2. `pnpm --filter @consistent/core dev`
3. `pnpm --filter @consistent/web dev`
4. Sign in at http://localhost:3000 (use the seeded account or sign up).
5. In the Assistant pane, send a message and wait for the agent reply.
6. Verify the DB row lands: `docker exec consistent-postgres-1 psql -U consistent -d consistent -c "SELECT id, role, thread_id FROM mastra.messages ORDER BY created_at DESC LIMIT 5;"`
7. Reload the page. Pane resets to the empty state. Confirm via DevTools → Network that no `/v1/ai/threads/...` request is issued.

## Acceptance for the fix

- After reload, the Assistant pane shows prior messages (scrolled to bottom; existing compact-height container preserved).
- Older turns reachable by scrolling up inside the pane.
- A user's sub-thread attempt (`isOwnedBy` guard) still returns 403 for cross-user threads.
- No changes needed server-side unless the shape is wrong — backend endpoint is already implemented.

## Files to start from

- `apps/web/src/components/coach/coach.tsx` — runtime/transport wiring.
- `apps/web/src/components/coach/history-adapter.ts` — adapter + message shape.
- `apps/web/src/components/coach/thread.tsx` — renders `ThreadPrimitive.Messages`.
- `apps/core/src/ai/ai.controller.ts` — server endpoint, verified live.
- `apps/core/src/ai/thread-id.ts` — `buildThreadId` + `isOwnedBy`.

## What to avoid

- Don't switch to `useRemoteThreadListRuntime` just to solve this — that escalates scope to a full thread-list UI (sidebar, rename, archive), which the spec explicitly defers ([design doc §Q4](./superpowers/specs/2026-04-17-ai-assistant-wiring-design.md)). Stay with the single-thread-per-user model; just get history to load on mount.
- Don't re-implement the append side of the adapter. Mastra's `chatRoute` already persists via the memory storage; a client-side `append` would double-write.
