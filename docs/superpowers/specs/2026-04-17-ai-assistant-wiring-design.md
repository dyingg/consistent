# AI Assistant Wiring — Design

**Date:** 2026-04-17
**Status:** Approved (brainstorm)
**Scope:** Wire the dashboard chat UI to a real Mastra agent with tools, streaming, and persistent thread memory.

## Context

- `apps/core` has 4 goal tools scaffolded in `src/ai/tools/`. Tests assert 16 tools total (4 goal + 7 task + 5 schedule), so 12 remain unwritten.
- Tools already pull `userId` from `requestContext.get("mastra__resourceId")`, matching what `@mastra/auth-better-auth` injects.
- Dashboard assistant pane (`apps/web/src/app/(app)/page.tsx:741-788`) returns canned responses with a fake timer.
- Installed: `@mastra/core@1.25`, `@mastra/express@1.3.9`, `@mastra/auth-better-auth@1.0.2`, `@ai-sdk/openai@3.0.53`. Env vars `AI_MODEL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` exist.
- Realtime Socket.IO already broadcasts `goal:updated` / `task:updated` / `schedule:updated` when services mutate state. Tools call those services, so dashboard refreshes live when the agent acts.

## Decisions

| # | Decision |
|---|---|
| 1 | Mount Mastra's Express server in-process at `/chat/*` (via `@mastra/express`), alongside existing `/api/auth/*` and `/v1/*`. |
| 2 | Expose the agent to assistant-ui via `@mastra/ai-sdk`'s `chatRoute({ path: "/chat/:agentId" })`. |
| 3 | Auth via `@mastra/auth-better-auth` — reuses the existing Better Auth session cookie. Sets `mastra__resourceId` in requestContext automatically. |
| 4 | Thread memory in Postgres via `@mastra/pg`'s `PgStore`, scoped to `schemaName: "mastra"` so Drizzle/domain tables stay untouched. `store.init()` runs at bootstrap; no Drizzle migration is added. |
| 5 | Streaming end-to-end: SSE from Mastra → assistant-ui's `useChatRuntime` + `AssistantChatTransport` on the frontend. Markdown rendering comes from assistant-ui. |
| 6 | One persistent thread per user. `threadId = buildThreadId(userId)` returns `assistant-${userId}` today; helper is centralized so we can move to `assistant-${userId}-${subId}` later with a single change. |
| 7 | Mentor-coach persona. Flow: interview → breakdown (Fibonacci sprint points 1-13, `context` field written per task explaining *what* + *why*) → `bulk-create-tasks`. Agent updates `context` on later task edits. |
| 8 | Model: `openai/gpt-5.2` as default (modern, strong reasoning, non-top-tier cost). Configurable via `env.AI_MODEL`. |
| 9 | Destructive confirmation only on delete operations — agent states the action in text and waits for the user's next turn before calling `delete-*`. |
| 10 | Mastra code lives inside `apps/core/src/ai/` (in-process, shares DI with existing domain services). |

## Architecture

```
┌─────────────────────────── apps/web ────────────────────────────┐
│  <Coach />                                                       │
│    <AssistantRuntimeProvider runtime={chatRuntime}>              │
│      <Thread />   ← @assistant-ui/react                          │
│                                                                  │
│  chatRuntime:                                                    │
│    - transport: AssistantChatTransport(api, credentials, body)   │
│    - adapters.history: GET /v1/ai/threads/:threadId/messages     │
└─────────────────────────────────────────────────────────────────-┘
                              │ POST cookie + SSE
                              ▼
┌─────────────────────────── apps/core ──────────────────────────-┐
│  main.ts Express routes:                                         │
│    /api/auth/*  → Better Auth (raw)                              │
│    /v1/*        → NestJS versioned REST                          │
│    /chat/*      → MastraServer (mounted in bootstrap)            │
│                                                                  │
│  AiModule:                                                       │
│    • imports Goals/Tasks/Scheduling modules                      │
│    • providers: TOOLS_FACTORY, MEMORY, AGENT, MASTRA             │
│    • MastraBootstrap (onApplicationBootstrap):                   │
│          await store.init()                                      │
│          mastra.server.mount(express)                            │
│    • AiController: GET /v1/ai/threads/:threadId/messages         │
│                                                                  │
│  Tools (16):                                                     │
│    goals.tools.ts (4 — done)                                     │
│    tasks.tools.ts (7 — new)                                      │
│    scheduling.tools.ts (5 — new)                                 │
│  All read userId from requestContext.mastra__resourceId.         │
│  All call existing services → services broadcast realtime.       │
└─────────────────────────────────────────────────────────────────-┘
                              │
                              ▼
┌─────────────────────────── Postgres ───────────────────────────-┐
│  public.*   — existing domain tables (Drizzle-owned)             │
│  mastra.*   — threads, messages, resources (Mastra-owned)        │
└─────────────────────────────────────────────────────────────────-┘
```

### Three URL namespaces

| Prefix | Owner | Auth | Managed by |
|---|---|---|---|
| `/api/auth/*` | Better Auth handler | Itself | Raw Express route in `main.ts` |
| `/v1/*` | NestJS REST | `AuthGuard` + `@CurrentUser()` | NestJS controllers |
| `/chat/*` | Mastra agent streaming | `MastraAuthBetterAuth` | MastraServer mounted in `AiModule` |

## Components

### Backend — new files under `apps/core/src/ai/`

1. **`agent.ts`** — `createCoachAgent(tools, memory)`. Name `"consistent-coach"`, model from `env.AI_MODEL`, tools, memory, `instructions` from the prompt module.
2. **`prompts/coach.ts`** — exports `COACH_SYSTEM_PROMPT`. Covers persona (warm-firm mentor), interview-first rule, breakdown rules with Fibonacci 1-13 examples, `context` field guidance (what + why), update-the-context-as-tasks-evolve rule, delete confirmation rule.
3. **`tools/tasks.tools.ts`** — 7 tools: `get-tasks`, `get-ready-tasks`, `get-goal-dag`, `create-task`, `bulk-create-tasks`, `update-task`, `delete-task`.
4. **`tools/scheduling.tools.ts`** — 5 tools: `get-schedule`, `get-current-block`, `create-block`, `update-block`, `delete-block`.
5. **`tools/index.ts`** — extend existing `createTools()` to include task + scheduling tools.
6. **`memory.ts`** — `createMemory(connectionString)` returns a `Memory` wrapping `new PgStore({ connectionString, schemaName: "mastra" })`.
7. **`mastra.ts`** — `createMastra(agent)` returns a `Mastra` with `server.auth: MastraAuthBetterAuth` and `server.apiRoutes: [chatRoute({ path: "/chat/:agentId" })]`.
8. **`ai.module.ts`** — NestJS module. Imports Goals/Tasks/Scheduling modules. Providers: `TOOLS_FACTORY`, `MEMORY`, `AGENT`, `MASTRA`, `MastraBootstrap`. Exports nothing (internal).
9. **`ai.bootstrap.ts`** — `MastraBootstrap` service. `onApplicationBootstrap`: `await store.init()`, then mounts Mastra's Express routes onto the running NestJS Express instance. Fails fast on init error.
10. **`ai.controller.ts`** — `GET /v1/ai/threads/:threadId/messages`. `AuthGuard` + `@CurrentUser()`. Enforces `threadId === buildThreadId(userId)`. Reads from injected `MEMORY`, maps Mastra messages to assistant-ui shape.
11. **`thread-id.ts`** — shared helper `buildThreadId(userId, subId?)`. Single source of truth so the scheme can evolve.

### Backend — changed files

- `apps/core/src/app.module.ts` — add `AiModule`.
- `apps/core/src/env.ts` — tighten: require `OPENAI_API_KEY` when `AI_MODEL` starts with `openai/` (and `ANTHROPIC_API_KEY` when `anthropic/`).
- `apps/core/package.json` — add `@mastra/ai-sdk@^1.4.0`, `@mastra/pg@^1.9.1`.

### Frontend — new files under `apps/web/src/`

1. **`components/coach/coach.tsx`** — client component. Wraps `<Thread />` in `<AssistantRuntimeProvider>`. Configures `useChatRuntime` with `AssistantChatTransport` (api = `${API_URL}/chat/consistent-coach`, `credentials: "include"`, `body` includes `threadId`) and a `history` adapter that GETs `/v1/ai/threads/:threadId/messages`.
2. **`components/coach/thread-id.ts`** — frontend mirror of the backend `buildThreadId` helper. Kept in lockstep by convention; a mismatch would trigger the cross-user 403 guard in dev, so drift is self-detecting. If a third caller ever needs the helper, promote it to `packages/contracts`.
3. **`components/coach/thread.tsx`** — wraps assistant-ui's `<Thread />` for local styling (matches existing glass-card aesthetic, keeps compact height).

### Frontend — changed files

- `apps/web/src/app/(app)/page.tsx` — remove `AIChatSection` (incl. `ChatMessage` type, `aiResponses`, scroll/typing state). Mount `<Coach />` in the same slot to preserve dashboard layout (Now → Assistant → Today above the fold per existing layout memory).
- `apps/web/package.json` — add `@assistant-ui/react@^0.12.25`, `@assistant-ui/react-ai-sdk@^1.3.19`.

## Data flow

### Goal intake (happy path)

1. User sends "Set up a goal to master Go" in `<Thread />`.
2. Transport POSTs `/chat/consistent-coach` with body `{ id, messages, threadId }` and the session cookie.
3. `MastraAuthBetterAuth` validates the cookie, sets `requestContext.mastra__resourceId = userId`.
4. `chatRoute` calls `agent.stream(messages, { resourceId, threadId, requestContext })`.
5. Mastra loads prior messages for the thread from `mastra.messages`, prepends them, streams to the model.
6. Model asks clarifying questions; no tool call yet. Tokens stream to the UI; Mastra persists messages.
7. After enough signal, model emits `create-goal`, then `bulk-create-tasks` with titles, descriptions, `context`, `estimatedMinutes`, `sprintPoints`, and dependency edges.
8. Tools call `GoalsService` / `TasksService`, which emit realtime events via `RealtimeGateway`.
9. Model summarizes the plan to the user. Stream closes. Dashboard panels refetch live via the existing realtime → React Query loop.

### Delete (confirmation)

1. User: "delete the Go goal".
2. Model (per system prompt): "I'm about to delete 'Master Go' and its 9 tasks. Type 'yes' to confirm."
3. On user's next turn with confirmation, model calls `delete-goal(goalId)`.
4. Service cascade-deletes. Realtime events fire. Model confirms completion.

### Page load with history

1. `<Thread />` mounts inside the compact pane (existing max-height preserved).
2. `ThreadHistoryAdapter.load()` GETs `/v1/ai/threads/assistant-<uid>/messages`.
3. Controller reads from Memory, maps shape, returns.
4. `<Thread />` renders history, auto-scrolls to bottom — user sees the last interaction by default; scroll up reveals older turns.

### Auth failure

`MastraAuthBetterAuth` returns null → 401 → `<Thread />` surfaces the error. App-level session redirect handles the next navigation.

## Error handling

**Model / provider.** Missing API key fails at boot (env schema tightened). Provider errors surface in the stream and render in assistant-ui's error slot. Malformed tool args trigger Mastra's built-in retry loop via Zod validation feedback.

**Tool errors.** Each tool wraps its `execute()` in a try/catch that returns `{ error: true, message }` derived from the Nest `HttpException` message. Covers ownership failures, not-found, DAG cycle rejection from the DB trigger, and transactional rollback on bulk failures. The model sees the structured error and can adapt or report to the user.

**Stream interruption.** User-triggered abort (tab close, stop button) stops the agent. Partial assistant message is persisted with a `finishReason: "aborted"` tag. Tool calls in flight finish — services don't honor `AbortSignal` in MVP (accepted: DB writes complete in ms; next turn's `get-*` query reconciles).

**Memory.** `PgStore.init()` failure at boot throws and prevents startup. Write failures after a successful stream are logged and swallowed — user sees the reply but it won't appear on reload (rare; acceptable for MVP).

**Cross-user threadId guard.** Both `/chat/*` (in a thin request middleware) and `/v1/ai/threads/:threadId/messages` (in the controller) enforce `threadId === buildThreadId(userId)`. Mismatch → 403. Prevents thread-scraping attacks.

**Out of scope.** Rate limiting, perf testing, prompt evals, cross-thread memory, abort-aware services — deferred; tracked in `CLAUDE.md`'s "Not built yet" list.

## Testing

**Unit — tools.** Per-tool-group specs (`tasks.tools.spec.ts`, `scheduling.tools.spec.ts`) mirror the existing `goals` pattern: mock service, mock `requestContext`, assert service called with `userId` + correct args, assert return shape. Existing `tools.spec.ts` already asserts the 16-tool shape.

**Unit — factories.** `agent.spec.ts` asserts name, model, tool keys, and that the system prompt contains canary strings ("Fibonacci", delete-confirmation phrasing). `memory.spec.ts` asserts `createMemory()` returns a `Memory` given a connection string.

**Integration — backend.** `mastra.integration.spec.ts` uses `MockLanguageModelV1` to drive the stream endpoint end-to-end: verify 200 with session, 401 without, 403 on cross-user threadId, and that a model-emitted tool_call reaches `GoalsService.create` with the correct `userId`. `history.integration.spec.ts` covers the GET endpoint with the same auth matrix.

**E2E — Playwright.** `e2e/coach.spec.ts`: sign in → send "Create a goal to learn Go" → assert streaming response → assert dashboard Goals pane updates → reload → assert Assistant pane shows prior messages. Gated `E2E_LLM=real` flag decides whether to hit real OpenAI or stub at the transport.

**Manual checklist** (one-time after implementation, not in CI): real LLM interview creates real goal + tasks with populated `context` and Fibonacci sprint points; delete requires confirmation; dashboard updates live; reload preserves history.

**Explicitly out of scope.** Prompt-quality evals, load tests, multi-thread memory tests, abort-through-service tests.

## Migration / rollout

- No data migration. Mastra's `store.init()` creates `mastra.*` on first boot.
- DB role needs `CREATE` on either `public` or `mastra` schema. Documented in `.env.example` and `CLAUDE.md`.
- Feature flag: none for MVP. The assistant pane simply replaces the canned one.
- Rollback: revert the `AiModule` import from `app.module.ts` and the `<Coach />` mount in `page.tsx`. Mastra's `mastra.*` tables can stay (unused) or be dropped manually.

## Open questions / deferred

- Thread list UI (multiple conversations per user).
- Working memory / user profile scratchpad.
- Rate limiting on `/chat/*`.
- OpenTelemetry tracing of tool calls.
- Agent-initiated messages (proactive nudges from the mentor).

## Appendix — package additions

**`apps/core/package.json`**
- `@mastra/ai-sdk@^1.4.0`
- `@mastra/pg@^1.9.1`

**`apps/web/package.json`**
- `@assistant-ui/react@^0.12.25`
- `@assistant-ui/react-ai-sdk@^1.3.19`
