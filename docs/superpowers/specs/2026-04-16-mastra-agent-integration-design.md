# Mastra Agent Integration Design

## Overview

Integrate a Mastra AI agent into the Consistent backend, served through the existing Express app via `@mastra/express`. The agent provides a reactive chat assistant (users interact via the dashboard) and lays groundwork for proactive triggers (event-driven nudges and scheduled summaries, built later).

This effort also renames `apps/api` to `apps/core` to reflect the backend's expanded role beyond REST endpoints.

## Goals

- Ship an AI assistant that helps users manage goals, tasks, dependencies, and schedule blocks through natural conversation
- Use Mastra's Express adapter to mount on the existing Express app (same pattern as Better Auth)
- Authenticate via existing Better Auth database sessions (cookie-based, horizontally scalable)
- Give the agent full CRUD access to domain services via direct NestJS service injection
- Make the LLM provider/model configurable via environment variable
- Provide Mastra Studio in development for agent testing and debugging
- Design proactive trigger interfaces now, implement later

## Non-Goals

- Persistent agent memory (stateless for now, designed for later addition)
- Proactive delivery channels (WebSocket push, push notifications, email — interfaces defined, not implemented)
- OAuth providers or additional auth methods
- Multi-agent orchestration

## Architecture

### Request Flow

```
Browser (dashboard chat panel)
  |
  |-- POST /v1/*          --> NestJS controllers (goals, tasks, schedule)
  |-- POST /api/auth/*    --> Better Auth handler
  +-- POST /mastra/*      --> MastraServer (Express adapter)
                               |
                               |-- @mastra/auth-better-auth validates session cookie
                               |-- Looks up session in Postgres (same DB, same table)
                               |-- Sets requestContext.set('resourceId', user.id)
                               |
                               +-- Agent.stream() / Agent.generate()
                                    |
                                    +-- Tool execute(input, context)
                                         |-- context.requestContext.get('resourceId') --> userId
                                         |-- Calls NestJS services directly (in-process)
                                         |   |-- GoalsService
                                         |   |-- TasksService
                                         |   +-- SchedulingService
                                         +-- Returns result to LLM
```

Three systems, one Express app, one port. Each owns its route prefix. Auth is cookie-based database sessions throughout — horizontally scalable because sessions are stored in Postgres, not in-memory.

### Tool Call Flow (Clarification)

The LLM does **not** make HTTP calls back to the app. Tool execution is in-process:

1. User sends message --> hits Mastra route --> agent sends prompt + tool definitions to the LLM
2. LLM responds with "call `create-task` with these args" (JSON, not HTTP)
3. Mastra executes the tool's `execute` function **in the same Node process** — this is where `TasksService.create()` runs
4. Result goes back to the LLM --> LLM formulates response --> streams to client

### Proactive Triggers (Designed Now, Built Later)

```
Event (task:updated) or Cron
  |
  +-- AiService.nudge(userId, context)
       +-- Agent.generate() --> Tool calls --> produces message
            +-- DeliveryService.send(userId, message)  // channel TBD
```

Event-driven: `AiService` subscribes to existing realtime events (`goal:updated`, `task:updated`, `schedule:updated`) and decides whether to nudge.

Scheduled: Cron-triggered method (via NestJS `@Cron()` or external scheduler) generates daily summaries per active user.

Delivery interface (placeholder):

```typescript
interface DeliveryService {
  send(userId: string, message: string, channel?: 'websocket' | 'push' | 'email'): Promise<void>
}
```

## Project Structure

```
apps/core/                          # renamed from apps/api
  src/
    ai/
      ai.module.ts                  # NestJS module — creates Mastra, mounts on Express
      ai.service.ts                 # Programmatic agent access (for proactive triggers)
      agent.ts                      # Agent definition (instructions, model config)
      tools/
        index.ts                    # Barrel export, tool registry
        get-goals.tool.ts
        create-goal.tool.ts
        update-goal.tool.ts
        delete-goal.tool.ts
        get-tasks.tool.ts
        get-ready-tasks.tool.ts
        get-goal-dag.tool.ts
        create-task.tool.ts
        bulk-create-tasks.tool.ts
        update-task.tool.ts
        delete-task.tool.ts
        get-schedule.tool.ts
        get-current-block.tool.ts
        create-block.tool.ts
        update-block.tool.ts
        delete-block.tool.ts
    # ... existing modules unchanged (goals/, tasks/, scheduling/, auth/, etc.)
  package.json                      # name: @consistent/core
```

## Rename: `apps/api` to `apps/core`

The backend hosts REST endpoints, WebSocket gateway, Better Auth, and now an AI agent with future cron triggers. "API" no longer describes its role.

### Files affected

| File / Location | Change |
|-----------------|--------|
| `apps/api/` directory | Rename to `apps/core/` |
| `apps/core/package.json` | `"name": "@consistent/core"` |
| `turbo.json` | Update any `@consistent/api` references |
| Root `package.json` | Scripts with `--filter @consistent/api` --> `--filter @consistent/core` |
| `apps/core/Dockerfile` | Internal path references |
| `packages/*` | Any workspace imports of `@consistent/api` |
| `docker-compose.yml` | Build context path |
| `.github/workflows/` | CI workflow filters if any |

## Auth Integration

### How it works

`@mastra/auth-better-auth` receives the same `auth` instance from `@consistent/auth` that the existing `AuthGuard` uses. One auth config, two consumers.

```typescript
import { MastraAuthBetterAuth } from '@mastra/auth-better-auth'
import { auth } from '@consistent/auth'

const mastraAuth = new MastraAuthBetterAuth({ auth })

const mastra = new Mastra({
  agents: { 'consistent-agent': agent },
  server: { auth: mastraAuth },
})
```

### Session validation

- Browser sends session cookie (httpOnly, set by Better Auth on sign-in)
- `@mastra/auth-better-auth` calls `auth.api.getSession()` — same as `AuthGuard`
- Session looked up in Postgres by token — horizontally scalable, no sticky sessions
- userId set on `requestContext` — tools read it via `context.requestContext.get('resourceId')`
- No JWT anywhere in this flow

### Why this scales

Sessions are in Postgres, not in-memory. Any API instance can validate any session. Load balancer needs no sticky session config. This is unchanged from the existing auth setup — Mastra inherits the same scalability properties.

## Agent Definition

Single agent with dynamic instructions and configurable model:

```typescript
const agent = new Agent({
  id: 'consistent-agent',
  name: 'Consistent',
  model: () => getConfiguredModel(),  // reads AI_MODEL env var
  instructions: () => `
    You are Consistent, a productivity assistant.
    You help users break down goals into tasks, manage dependencies,
    schedule work blocks, and stay motivated.

    Current time: ${new Date().toISOString()}

    Guidelines:
    - Always check the user's current goals and progress before making suggestions
    - When creating tasks, consider existing dependencies in the DAG
    - When deleting goals, tasks, or blocks, confirm with the user first
    - Be encouraging but not overbearing
    - Keep responses concise and actionable
  `,
  tools: { ...allTools },
})
```

Model configured via `AI_MODEL` env var using Mastra's model router (`"provider/model-name"` format). Switching providers requires only changing the env var and ensuring the corresponding API key is set.

## Tool Inventory

| Tool | Service | Description |
|------|---------|-------------|
| `get-goals` | GoalsService | List goals with computed progress percentages |
| `create-goal` | GoalsService | Create a new goal |
| `update-goal` | GoalsService | Update goal title, status, context |
| `delete-goal` | GoalsService | Delete a goal (confirm with user first) |
| `get-tasks` | TasksService | List tasks for a goal |
| `get-ready-tasks` | TasksService | Find unblocked pending tasks across all goals |
| `get-goal-dag` | TasksService | Get dependency graph for a goal |
| `create-task` | TasksService | Create a single task under a goal |
| `bulk-create-tasks` | TasksService | Break down a goal into tasks with dependencies |
| `update-task` | TasksService | Change task status, title, context |
| `delete-task` | TasksService | Delete a task (confirm with user first) |
| `get-schedule` | SchedulingService | Get schedule blocks for a date range |
| `get-current-block` | SchedulingService | What is the user working on right now? |
| `create-block` | SchedulingService | Schedule a time block for a task |
| `update-block` | SchedulingService | Update block status |
| `delete-block` | SchedulingService | Delete a schedule block (confirm with user first) |

### Tool pattern

Each tool follows the same structure:

```typescript
const getGoals = createTool({
  id: 'get-goals',
  description: 'Get all goals for the current user, with progress percentages',
  inputSchema: z.object({
    status: z.enum(['active', 'completed', 'abandoned']).optional(),
  }),
  outputSchema: z.object({ goals: z.array(goalSchema) }),
  execute: async (input, context) => {
    const userId = context.requestContext.get('resourceId')
    return { goals: await goalsService.findAll(userId, input.status) }
  },
})
```

NestJS services are captured via closure when tools are constructed in `ai.module.ts`. The module injects services through NestJS DI and passes them to a factory function that creates all tools.

## NestJS Module Wiring

```typescript
@Module({
  imports: [GoalsModule, TasksModule, SchedulingModule],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule implements OnModuleInit {
  constructor(
    private goalsService: GoalsService,
    private tasksService: TasksService,
    private schedulingService: SchedulingService,
    private httpAdapterHost: HttpAdapterHost,
  ) {}

  async onModuleInit() {
    // 1. Create tools with service references captured in closures
    const tools = createTools(
      this.goalsService,
      this.tasksService,
      this.schedulingService,
    )

    // 2. Create agent with tools
    const agent = createAgent(tools)

    // 3. Create Mastra instance with Better Auth
    const mastra = new Mastra({
      agents: { [agent.id]: agent },
      server: {
        auth: new MastraAuthBetterAuth({ auth }),
      },
    })

    // 4. Mount on Express via adapter
    const express = this.httpAdapterHost.httpAdapter.getInstance()
    const server = new MastraServer({ app: express, mastra, prefix: '/mastra' })
    await server.init()
  }
}
```

`AiModule` is imported in `AppModule`. The `OnModuleInit` lifecycle hook runs after DI is resolved but before the app starts listening — Mastra routes are ready when the first request arrives.

## Environment Variables

### New variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AI_MODEL` | No | `openai/gpt-4o` | Mastra model router string (`provider/model-name`) |
| `OPENAI_API_KEY` | Conditional | — | Required when `AI_MODEL` uses the `openai` provider |
| `ANTHROPIC_API_KEY` | Conditional | — | Required when `AI_MODEL` uses the `anthropic` provider |

Provider API key is validated at runtime based on which provider `AI_MODEL` specifies.

### New dependencies

```
@mastra/core
@mastra/express
@mastra/auth-better-auth
@ai-sdk/openai
```

Additional provider SDKs (e.g., `@ai-sdk/anthropic`) installed as needed.

## Frontend: Chat Panel

### Library

Use [assistant-ui](https://www.assistant-ui.com/) (`@assistant-ui/react`) for the chat interface. Provides pre-built React components for streaming chat, message rendering, tool call indicators, and loading states.

### Integration

- Install `@assistant-ui/react` in `apps/web`
- Replace canned assistant chat section on the dashboard with assistant-ui components
- Point at `/mastra/agents/consistent-agent/stream`
- Session cookie flows automatically (`credentials: 'include'`)
- Messages stored in React state (no backend persistence until memory is added)
- Chat history resets on page reload

### What assistant-ui handles

- Streaming token rendering
- Tool call status indicators (agent is "working" on something)
- Message bubbles with role differentiation
- Error states

## Deferred Work

These items are designed for but not implemented in this effort:

| Item | Status | Notes |
|------|--------|-------|
| Persistent agent memory | Interface designed | Add `@mastra/memory` + storage backend later. Docs: `mastra.ai/docs/agents/agent-memory` |
| Event-driven nudges | `AiService` interface defined | Subscribe to realtime events, evaluate and nudge |
| Scheduled summaries | `AiService` interface defined | Daily/periodic agent-generated briefings |
| Delivery channels | `DeliveryService` interface defined | WebSocket push, browser notifications, email |
| Multi-provider hot-swap | Env var pattern established | Add provider SDKs as needed |

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Mastra mounted on Express (not NestJS-native routes) | Official adapter, enables Mastra Studio, mirrors Better Auth pattern |
| Tools call services directly (not HTTP self-calls) | Performance, power — tools can use transactions, read DAGs, no serialization overhead |
| Agent code lives in `apps/core/src/ai/` (not `packages/`) | Tools are tightly coupled to NestJS DI — shared package would have a dependency that only works inside the API |
| Single agent (not multiple specialized agents) | Start simple, one agent with all tools. Decompose later if instructions grow unwieldy |
| Stateless first, memory later | Reduces initial complexity. Tool calls fetch fresh data each time. Memory adds persistence when ready |
| Configurable model via env var | Mastra model router makes provider switching a config change, not a code change |
| assistant-ui for frontend chat | Pre-built streaming chat components, avoids building custom chat UI |
| Rename `apps/api` to `apps/core` | Backend now hosts REST, WebSocket, auth, and AI agent — "API" no longer describes its role |
