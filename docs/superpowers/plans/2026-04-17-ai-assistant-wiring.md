# AI Assistant Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the dashboard chat to a real Mastra agent with 16 tools, Postgres-backed thread memory, SSE streaming via assistant-ui, and history load on page reload.

**Architecture:** Mastra agent + tools live in-process under `apps/core/src/ai/`. A `MastraServer` from `@mastra/express` mounts a `chatRoute` at `/chat/:agentId` on the same Express instance NestJS uses. An Express middleware runs before chatRoute to inject server-derived `memory: { thread, resource }` so clients can't set them. Thread memory persists to Postgres in its own `mastra` schema via `@mastra/pg`. A NestJS controller at `GET /v1/ai/threads/:threadId/messages` serves history to the frontend's `ThreadHistoryAdapter`. Frontend uses `@assistant-ui/react` + `@assistant-ui/react-ai-sdk` with `useChatRuntime` + `AssistantChatTransport`.

**Tech Stack:** `@mastra/core@1.25`, `@mastra/ai-sdk@1.4`, `@mastra/memory@1.15`, `@mastra/pg@1.9`, `@mastra/express@1.3`, `@mastra/auth-better-auth@1.0`, `@ai-sdk/openai@3.0`, `@assistant-ui/react@0.12`, `@assistant-ui/react-ai-sdk@1.3`, NestJS 11, Express 5, Drizzle 0.45, Better Auth 1.6.

**Spec:** `docs/superpowers/specs/2026-04-17-ai-assistant-wiring-design.md`

---

## Notes for implementers

- Mastra APIs evolve quickly. Before writing Agent/Memory/Mastra factory code, **read the installed embedded docs first** (`apps/core/node_modules/@mastra/<pkg>/dist/docs/references/`). If the doc contradicts this plan, trust the embedded doc and flag the deviation.
- The model ID `openai/gpt-5.2` is the chosen default; don't substitute. If it's not in `@mastra/core/dist/provider-registry.json`, pause and ask.
- Tools already follow a pattern in `apps/core/src/ai/tools/goals.tools.ts`. Match it. Each tool: `createTool({ id, description, inputSchema, outputSchema, execute })`, pull `userId` from `context.requestContext.get("mastra__resourceId")`.
- Repositories follow the `rows.at(0) ?? null` nullable pattern (see recent fixes). Services raise Nest `HttpException`s on ownership / validation failures. Tools should try/catch and return `{ error: true, message }` to the model.
- All services (`GoalsService`, `TasksService`, `SchedulingService`) already emit realtime events when mutating. Tools just call them; no extra realtime wiring needed.
- Use `pnpm --filter @consistent/core test` / `pnpm --filter @consistent/web ...` to scope pnpm commands to a workspace.

---

## File Structure

### New — `apps/core/src/ai/`

```
ai/
├── ai.module.ts            # NestJS module
├── ai.bootstrap.ts         # onApplicationBootstrap: store.init() + mount MastraServer
├── ai.controller.ts        # GET /v1/ai/threads/:threadId/messages
├── ai.middleware.ts        # Express middleware: inject memory config, enforce threadId ownership
├── ai.module.spec.ts       # Integration tests (stubbed model)
├── agent.ts                # createCoachAgent(tools, memory)
├── agent.spec.ts
├── mastra.ts               # createMastra(agent, memory, auth)
├── memory.ts               # createMemory(connectionString)
├── memory.spec.ts
├── thread-id.ts            # buildThreadId(userId, subId?)
├── thread-id.spec.ts
├── prompts/
│   └── coach.ts            # COACH_SYSTEM_PROMPT
├── tools/
│   ├── goals.tools.ts      # (existing, 4 tools)
│   ├── tasks.tools.ts      # NEW: 7 tools
│   ├── scheduling.tools.ts # NEW: 5 tools
│   ├── index.ts            # wire all 16 (existing, extend)
│   ├── tools.spec.ts       # (existing, asserts 16 tools + goal execution)
│   ├── tasks.tools.spec.ts # NEW: per-tool execution specs
│   └── scheduling.tools.spec.ts # NEW: per-tool execution specs
```

### Modified — `apps/core/src/`

- `app.module.ts` — import `AiModule`.
- `env.ts` — require `OPENAI_API_KEY` when `AI_MODEL` starts with `openai/`.

### New — `apps/web/src/components/coach/`

```
coach/
├── coach.tsx               # <Coach /> wrapper with AssistantRuntimeProvider
├── thread.tsx              # styled <Thread /> for compact dashboard pane
├── thread-id.ts            # buildThreadId(userId) — mirrors backend
└── history-adapter.ts      # ThreadHistoryAdapter → GET /v1/ai/threads/:id/messages
```

### Modified — `apps/web/src/`

- `app/(app)/page.tsx` — remove `AIChatSection` (+ `ChatMessage` type, `aiResponses` const, scroll/typing state); mount `<Coach />` in its slot.

### Modified — root / packages

- `apps/core/package.json` — add `@mastra/ai-sdk`, `@mastra/memory`, `@mastra/pg`.
- `apps/web/package.json` — add `@assistant-ui/react`, `@assistant-ui/react-ai-sdk`.
- `.env.example` — document DB role requirement for `mastra` schema.
- `CLAUDE.md` — update "What's Not Built Yet" and add AI module to repo map.

---

## Task 1: Install backend dependencies

**Files:**
- Modify: `apps/core/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Install packages**

Run:
```bash
pnpm --filter @consistent/core add @mastra/ai-sdk@^1.4.0 @mastra/memory@^1.15.1 @mastra/pg@^1.9.1
```

Expected: lockfile updated, `apps/core/node_modules/@mastra/{ai-sdk,memory,pg}` present.

- [ ] **Step 2: Verify typecheck still passes**

Run:
```bash
pnpm --filter @consistent/core typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/core/package.json" "pnpm-lock.yaml"
git commit -m "chore(core): add mastra ai-sdk, memory, and pg packages"
```

---

## Task 2: Tighten env validation

**Files:**
- Modify: `apps/core/src/env.ts`

- [ ] **Step 1: Read the current env schema**

Confirm shape in `apps/core/src/env.ts`. You should see `OPENAI_API_KEY: z.string().optional()` and similar for Anthropic.

- [ ] **Step 2: Replace the schema**

Update `apps/core/src/env.ts` to:

```ts
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url(),
    WEB_ORIGIN: z.string().url(),
    PORT: z
      .string()
      .transform(Number)
      .pipe(z.number().int().positive())
      .default("3001"),
    AI_MODEL: z.string().default("openai/gpt-5.2"),
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
  },
  runtimeEnv: process.env,
}).superRefine((e, ctx) => {
  if (e.AI_MODEL.startsWith("openai/") && !e.OPENAI_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OPENAI_API_KEY"],
      message: "OPENAI_API_KEY is required when AI_MODEL uses the openai provider",
    });
  }
  if (e.AI_MODEL.startsWith("anthropic/") && !e.ANTHROPIC_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ANTHROPIC_API_KEY"],
      message: "ANTHROPIC_API_KEY is required when AI_MODEL uses the anthropic provider",
    });
  }
});
```

Note: `@t3-oss/env-core` returns a Zod object. `superRefine` on it may need a small adjustment depending on the version. If TS complains, fall back to running `.superRefine` on an internal schema before wrapping with `createEnv`. Verify against `node_modules/@t3-oss/env-core/dist/*.d.ts`.

- [ ] **Step 3: Typecheck**

Run:
```bash
pnpm --filter @consistent/core typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/core/src/env.ts"
git commit -m "feat(core): require provider API key matching AI_MODEL prefix"
```

---

## Task 3: threadId helper (backend + frontend) with test

**Files:**
- Create: `apps/core/src/ai/thread-id.ts`
- Create: `apps/core/src/ai/thread-id.spec.ts`
- Create: `apps/web/src/components/coach/thread-id.ts`

- [ ] **Step 1: Write failing test**

Create `apps/core/src/ai/thread-id.spec.ts`:

```ts
import { buildThreadId } from "./thread-id";

describe("buildThreadId", () => {
  it("returns `assistant-${userId}` for the default thread", () => {
    expect(buildThreadId("user-123")).toBe("assistant-user-123");
  });

  it("appends a subId when provided", () => {
    expect(buildThreadId("user-123", "deep-work")).toBe(
      "assistant-user-123-deep-work",
    );
  });

  it("rejects empty userId", () => {
    expect(() => buildThreadId("")).toThrow();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run:
```bash
pnpm --filter @consistent/core test -- thread-id.spec
```

Expected: FAIL — `Cannot find module './thread-id'`.

- [ ] **Step 3: Implement backend helper**

Create `apps/core/src/ai/thread-id.ts`:

```ts
export function buildThreadId(userId: string, subId?: string): string {
  if (!userId) {
    throw new Error("buildThreadId: userId is required");
  }
  return subId ? `assistant-${userId}-${subId}` : `assistant-${userId}`;
}

export function isOwnedBy(threadId: string, userId: string): boolean {
  if (!userId) return false;
  return (
    threadId === buildThreadId(userId) ||
    threadId.startsWith(`${buildThreadId(userId)}-`)
  );
}
```

- [ ] **Step 4: Run test, expect pass**

Run:
```bash
pnpm --filter @consistent/core test -- thread-id.spec
```

Expected: PASS.

- [ ] **Step 5: Create frontend mirror**

Create `apps/web/src/components/coach/thread-id.ts`:

```ts
export function buildThreadId(userId: string, subId?: string): string {
  if (!userId) {
    throw new Error("buildThreadId: userId is required");
  }
  return subId ? `assistant-${userId}-${subId}` : `assistant-${userId}`;
}
```

Keep the two copies in lockstep by convention — a mismatch will be caught by the ownership guard in dev.

- [ ] **Step 6: Commit**

```bash
git add "apps/core/src/ai/thread-id.ts" "apps/core/src/ai/thread-id.spec.ts" "apps/web/src/components/coach/thread-id.ts"
git commit -m "feat(ai): add buildThreadId helper on both sides"
```

---

## Task 4: Implement 7 task tools

**Files:**
- Create: `apps/core/src/ai/tools/tasks.tools.ts`
- Create: `apps/core/src/ai/tools/tasks.tools.spec.ts`

- [ ] **Step 1: Read the existing pattern**

Read `apps/core/src/ai/tools/goals.tools.ts` for the tool shape. Read `apps/core/src/tasks/tasks.service.ts` for the method signatures you'll call: `findAllForGoal`, `findReadyForUser`, `getGoalDag`, `create`, `bulkCreate`, `update`, `delete`. Also read the Zod task insert schema in `packages/db/src/schema/zod.ts`.

- [ ] **Step 2: Write failing execution specs**

Create `apps/core/src/ai/tools/tasks.tools.spec.ts`:

```ts
import type { TasksService } from "../../tasks/tasks.service";
import { createTaskTools } from "./tasks.tools";

const mockRequestContext = {
  get: (key: string) => (key === "mastra__resourceId" ? "user-123" : undefined),
  set: jest.fn(),
  has: jest.fn(),
};
const mockContext = { requestContext: mockRequestContext } as any;

describe("task tools", () => {
  const svc = {
    findAllForGoal: jest.fn(),
    findReadyForUser: jest.fn(),
    getGoalDag: jest.fn(),
    create: jest.fn(),
    bulkCreate: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  } as unknown as TasksService;

  const tools = createTaskTools(svc);

  beforeEach(() => jest.clearAllMocks());

  it("get-tasks calls findAllForGoal with userId + goalId", async () => {
    (svc.findAllForGoal as jest.Mock).mockResolvedValue([{ id: 1 }]);
    const res = await tools["get-tasks"].execute({ goalId: 7 }, mockContext);
    expect(svc.findAllForGoal).toHaveBeenCalledWith("user-123", 7);
    expect(res).toEqual({ tasks: [{ id: 1 }] });
  });

  it("get-ready-tasks calls findReadyForUser with userId", async () => {
    (svc.findReadyForUser as jest.Mock).mockResolvedValue([]);
    await tools["get-ready-tasks"].execute({}, mockContext);
    expect(svc.findReadyForUser).toHaveBeenCalledWith("user-123");
  });

  it("get-goal-dag calls getGoalDag with userId + goalId", async () => {
    (svc.getGoalDag as jest.Mock).mockResolvedValue({ tasks: [], edges: [] });
    await tools["get-goal-dag"].execute({ goalId: 7 }, mockContext);
    expect(svc.getGoalDag).toHaveBeenCalledWith("user-123", 7);
  });

  it("create-task calls create with userId + data", async () => {
    (svc.create as jest.Mock).mockResolvedValue({ id: 1 });
    const input = { goalId: 7, title: "T", sprintPoints: 3 };
    await tools["create-task"].execute(input, mockContext);
    expect(svc.create).toHaveBeenCalledWith("user-123", input);
  });

  it("bulk-create-tasks calls bulkCreate with userId, goalId, tasks, edges", async () => {
    (svc.bulkCreate as jest.Mock).mockResolvedValue({ tasks: [], edges: [] });
    const input = {
      goalId: 7,
      tasks: [{ title: "A", sprintPoints: 1 }],
      edges: [{ fromIndex: 0, toIndex: 0 }],
    };
    await tools["bulk-create-tasks"].execute(input, mockContext);
    expect(svc.bulkCreate).toHaveBeenCalledWith("user-123", 7, input.tasks, input.edges);
  });

  it("update-task calls update with userId, taskId, patch", async () => {
    (svc.update as jest.Mock).mockResolvedValue({ id: 1 });
    await tools["update-task"].execute(
      { taskId: 1, title: "new" },
      mockContext,
    );
    expect(svc.update).toHaveBeenCalledWith("user-123", 1, { title: "new" });
  });

  it("delete-task calls delete with userId + taskId", async () => {
    (svc.delete as jest.Mock).mockResolvedValue(undefined);
    await tools["delete-task"].execute({ taskId: 1 }, mockContext);
    expect(svc.delete).toHaveBeenCalledWith("user-123", 1);
  });

  it("returns structured error when service throws", async () => {
    (svc.findAllForGoal as jest.Mock).mockRejectedValue(
      new Error("boom"),
    );
    const res = await tools["get-tasks"].execute({ goalId: 7 }, mockContext);
    expect(res).toEqual({ error: true, message: "boom" });
  });
});
```

- [ ] **Step 3: Run spec, expect failure**

Run:
```bash
pnpm --filter @consistent/core test -- tasks.tools.spec
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the 7 tools**

Create `apps/core/src/ai/tools/tasks.tools.ts`:

```ts
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { TasksService } from "../../tasks/tasks.service";

const RESOURCE_ID_KEY = "mastra__resourceId";

function getUserId(context: any): string {
  const userId = context?.requestContext?.get(RESOURCE_ID_KEY) as
    | string
    | undefined;
  if (!userId) throw new Error("unauthorized");
  return userId;
}

async function safe<T>(fn: () => Promise<T>): Promise<T | { error: true; message: string }> {
  try {
    return await fn();
  } catch (err) {
    return { error: true, message: err instanceof Error ? err.message : "internal_error" };
  }
}

const taskInput = z.object({
  title: z.string().describe("Short imperative title"),
  description: z.string().nullable().optional(),
  context: z
    .string()
    .nullable()
    .optional()
    .describe("Agent-written note on what this task is and why it matters"),
  estimatedMinutes: z.number().int().positive().nullable().optional(),
  sprintPoints: z
    .number()
    .int()
    .min(1)
    .max(13)
    .nullable()
    .optional()
    .describe("Fibonacci scale: 1, 2, 3, 5, 8, 13"),
  priority: z.number().int().min(1).max(5).optional(),
  earliestStart: z.string().nullable().optional(),
  deadline: z.string().nullable().optional(),
  contextTags: z.array(z.string()).nullable().optional(),
});

const edgeInput = z.object({
  fromIndex: z.number().int().min(0),
  toIndex: z.number().int().min(0),
});

export function createTaskTools(tasksService: TasksService) {
  const getTasks = createTool({
    id: "get-tasks",
    description: "List tasks for a goal.",
    inputSchema: z.object({ goalId: z.number() }),
    outputSchema: z.any(),
    execute: async (input, context) =>
      safe(async () => ({
        tasks: await tasksService.findAllForGoal(getUserId(context), input.goalId),
      })),
  });

  const getReadyTasks = createTool({
    id: "get-ready-tasks",
    description: "List tasks with no unresolved blockers that are ready to work on now.",
    inputSchema: z.object({}),
    outputSchema: z.any(),
    execute: async (_input, context) =>
      safe(async () => ({
        tasks: await tasksService.findReadyForUser(getUserId(context)),
      })),
  });

  const getGoalDag = createTool({
    id: "get-goal-dag",
    description: "Return all tasks and dependency edges for a goal as a DAG.",
    inputSchema: z.object({ goalId: z.number() }),
    outputSchema: z.any(),
    execute: async (input, context) =>
      safe(async () =>
        tasksService.getGoalDag(getUserId(context), input.goalId),
      ),
  });

  const createTask = createTool({
    id: "create-task",
    description:
      "Create a single task under a goal. Prefer bulk-create-tasks when adding multiple at once.",
    inputSchema: taskInput.extend({ goalId: z.number() }),
    outputSchema: z.any(),
    execute: async (input, context) =>
      safe(async () => ({
        task: await tasksService.create(getUserId(context), input),
      })),
  });

  const bulkCreateTasks = createTool({
    id: "bulk-create-tasks",
    description:
      "Create multiple tasks for a goal in a single transaction, with optional dependency edges referencing tasks by index.",
    inputSchema: z.object({
      goalId: z.number(),
      tasks: z.array(taskInput),
      edges: z.array(edgeInput).optional(),
    }),
    outputSchema: z.any(),
    execute: async (input, context) =>
      safe(async () =>
        tasksService.bulkCreate(
          getUserId(context),
          input.goalId,
          input.tasks,
          input.edges ?? [],
        ),
      ),
  });

  const updateTask = createTool({
    id: "update-task",
    description:
      "Update a task. Use this to evolve a task's context as understanding grows.",
    inputSchema: z.object({
      taskId: z.number(),
      title: z.string().optional(),
      description: z.string().nullable().optional(),
      context: z.string().nullable().optional(),
      status: z
        .enum([
          "pending",
          "ready",
          "scheduled",
          "in_progress",
          "completed",
          "blocked",
          "cancelled",
        ])
        .optional(),
      estimatedMinutes: z.number().int().positive().nullable().optional(),
      sprintPoints: z.number().int().min(1).max(13).nullable().optional(),
      priority: z.number().int().min(1).max(5).optional(),
      earliestStart: z.string().nullable().optional(),
      deadline: z.string().nullable().optional(),
      contextTags: z.array(z.string()).nullable().optional(),
    }),
    outputSchema: z.any(),
    execute: async (input, context) =>
      safe(async () => {
        const { taskId, ...patch } = input;
        return {
          task: await tasksService.update(getUserId(context), taskId, patch),
        };
      }),
  });

  const deleteTask = createTool({
    id: "delete-task",
    description:
      "Permanently delete a task. Always confirm with the user in the previous turn before calling this.",
    inputSchema: z.object({ taskId: z.number() }),
    outputSchema: z.any(),
    execute: async (input, context) =>
      safe(async () => {
        await tasksService.delete(getUserId(context), input.taskId);
        return { success: true };
      }),
  });

  return {
    "get-tasks": getTasks,
    "get-ready-tasks": getReadyTasks,
    "get-goal-dag": getGoalDag,
    "create-task": createTask,
    "bulk-create-tasks": bulkCreateTasks,
    "update-task": updateTask,
    "delete-task": deleteTask,
  };
}
```

If `TasksService.bulkCreate` doesn't take `(userId, goalId, tasks, edges)` exactly, adjust the tool to match. Run `pnpm --filter @consistent/core test` after implementation.

- [ ] **Step 5: Run spec, expect pass**

Run:
```bash
pnpm --filter @consistent/core test -- tasks.tools.spec
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/core/src/ai/tools/tasks.tools.ts" "apps/core/src/ai/tools/tasks.tools.spec.ts"
git commit -m "feat(ai): add 7 task tools with per-tool execution specs"
```

---

## Task 5: Implement 5 scheduling tools

**Files:**
- Create: `apps/core/src/ai/tools/scheduling.tools.ts`
- Create: `apps/core/src/ai/tools/scheduling.tools.spec.ts`

- [ ] **Step 1: Read the SchedulingService signatures**

Read `apps/core/src/scheduling/scheduling.service.ts` — verify method names: `getBlocksForRange`, `getCurrentBlock`, `createBlock`, `updateBlockStatus`, `deleteBlock`.

- [ ] **Step 2: Write failing spec**

Create `apps/core/src/ai/tools/scheduling.tools.spec.ts`:

```ts
import type { SchedulingService } from "../../scheduling/scheduling.service";
import { createSchedulingTools } from "./scheduling.tools";

const mockRequestContext = {
  get: (key: string) => (key === "mastra__resourceId" ? "user-123" : undefined),
  set: jest.fn(),
  has: jest.fn(),
};
const mockContext = { requestContext: mockRequestContext } as any;

describe("scheduling tools", () => {
  const svc = {
    getBlocksForRange: jest.fn(),
    getCurrentBlock: jest.fn(),
    createBlock: jest.fn(),
    updateBlockStatus: jest.fn(),
    deleteBlock: jest.fn(),
  } as unknown as SchedulingService;

  const tools = createSchedulingTools(svc);

  beforeEach(() => jest.clearAllMocks());

  it("get-schedule calls getBlocksForRange with Date objects", async () => {
    (svc.getBlocksForRange as jest.Mock).mockResolvedValue([]);
    const start = "2026-04-17T00:00:00Z";
    const end = "2026-04-18T00:00:00Z";
    await tools["get-schedule"].execute({ start, end }, mockContext);
    const [uid, s, e] = (svc.getBlocksForRange as jest.Mock).mock.calls[0];
    expect(uid).toBe("user-123");
    expect(s).toEqual(new Date(start));
    expect(e).toEqual(new Date(end));
  });

  it("get-current-block calls getCurrentBlock with userId", async () => {
    (svc.getCurrentBlock as jest.Mock).mockResolvedValue(null);
    await tools["get-current-block"].execute({}, mockContext);
    expect(svc.getCurrentBlock).toHaveBeenCalledWith("user-123");
  });

  it("create-block calls createBlock with normalized Dates", async () => {
    (svc.createBlock as jest.Mock).mockResolvedValue({ id: 1 });
    const input = {
      taskId: 42,
      startTime: "2026-04-17T09:00:00Z",
      endTime: "2026-04-17T10:00:00Z",
    };
    await tools["create-block"].execute(input, mockContext);
    expect(svc.createBlock).toHaveBeenCalledWith("user-123", {
      taskId: 42,
      startTime: new Date(input.startTime),
      endTime: new Date(input.endTime),
      scheduledBy: "llm",
    });
  });

  it("update-block calls updateBlockStatus", async () => {
    (svc.updateBlockStatus as jest.Mock).mockResolvedValue({ id: 1 });
    await tools["update-block"].execute(
      { blockId: 1, status: "completed" },
      mockContext,
    );
    expect(svc.updateBlockStatus).toHaveBeenCalledWith(
      "user-123",
      1,
      "completed",
    );
  });

  it("delete-block calls deleteBlock", async () => {
    (svc.deleteBlock as jest.Mock).mockResolvedValue(undefined);
    await tools["delete-block"].execute({ blockId: 1 }, mockContext);
    expect(svc.deleteBlock).toHaveBeenCalledWith("user-123", 1);
  });
});
```

- [ ] **Step 3: Run spec, expect failure**

Run: `pnpm --filter @consistent/core test -- scheduling.tools.spec`

Expected: FAIL — module not found.

- [ ] **Step 4: Implement scheduling tools**

Create `apps/core/src/ai/tools/scheduling.tools.ts`:

```ts
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { SchedulingService } from "../../scheduling/scheduling.service";

const RESOURCE_ID_KEY = "mastra__resourceId";

function getUserId(context: any): string {
  const userId = context?.requestContext?.get(RESOURCE_ID_KEY) as
    | string
    | undefined;
  if (!userId) throw new Error("unauthorized");
  return userId;
}

async function safe<T>(fn: () => Promise<T>): Promise<T | { error: true; message: string }> {
  try {
    return await fn();
  } catch (err) {
    return { error: true, message: err instanceof Error ? err.message : "internal_error" };
  }
}

export function createSchedulingTools(schedulingService: SchedulingService) {
  const getSchedule = createTool({
    id: "get-schedule",
    description: "Get scheduled blocks for a date range (inclusive start, exclusive end).",
    inputSchema: z.object({
      start: z.string().describe("ISO 8601 start timestamp"),
      end: z.string().describe("ISO 8601 end timestamp"),
    }),
    outputSchema: z.any(),
    execute: async (input, context) =>
      safe(async () => ({
        blocks: await schedulingService.getBlocksForRange(
          getUserId(context),
          new Date(input.start),
          new Date(input.end),
        ),
      })),
  });

  const getCurrentBlock = createTool({
    id: "get-current-block",
    description: "Get the block currently in progress, if any.",
    inputSchema: z.object({}),
    outputSchema: z.any(),
    execute: async (_input, context) =>
      safe(async () => ({
        block: await schedulingService.getCurrentBlock(getUserId(context)),
      })),
  });

  const createBlock = createTool({
    id: "create-block",
    description: "Schedule a time block for a task.",
    inputSchema: z.object({
      taskId: z.number(),
      startTime: z.string(),
      endTime: z.string(),
    }),
    outputSchema: z.any(),
    execute: async (input, context) =>
      safe(async () => ({
        block: await schedulingService.createBlock(getUserId(context), {
          taskId: input.taskId,
          startTime: new Date(input.startTime),
          endTime: new Date(input.endTime),
          scheduledBy: "llm",
        }),
      })),
  });

  const updateBlock = createTool({
    id: "update-block",
    description: "Update a scheduled block's status.",
    inputSchema: z.object({
      blockId: z.number(),
      status: z.enum(["planned", "confirmed", "completed", "missed", "moved"]),
    }),
    outputSchema: z.any(),
    execute: async (input, context) =>
      safe(async () => ({
        block: await schedulingService.updateBlockStatus(
          getUserId(context),
          input.blockId,
          input.status,
        ),
      })),
  });

  const deleteBlock = createTool({
    id: "delete-block",
    description:
      "Permanently delete a scheduled block. Confirm with the user in the previous turn before calling.",
    inputSchema: z.object({ blockId: z.number() }),
    outputSchema: z.any(),
    execute: async (input, context) =>
      safe(async () => {
        await schedulingService.deleteBlock(getUserId(context), input.blockId);
        return { success: true };
      }),
  });

  return {
    "get-schedule": getSchedule,
    "get-current-block": getCurrentBlock,
    "create-block": createBlock,
    "update-block": updateBlock,
    "delete-block": deleteBlock,
  };
}
```

- [ ] **Step 5: Run spec, expect pass**

Run: `pnpm --filter @consistent/core test -- scheduling.tools.spec`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/core/src/ai/tools/scheduling.tools.ts" "apps/core/src/ai/tools/scheduling.tools.spec.ts"
git commit -m "feat(ai): add 5 scheduling tools with execution specs"
```

---

## Task 6: Wire all 16 tools in `tools/index.ts`

**Files:**
- Modify: `apps/core/src/ai/tools/index.ts`

- [ ] **Step 1: Verify target test state**

Run: `pnpm --filter @consistent/core test -- tools.spec`

Expected: 3 failing tests (the 16-tool assertion plus task/schedule inclusion checks from pre-existing `tools.spec.ts`).

- [ ] **Step 2: Update `tools/index.ts`**

Replace contents:

```ts
import type { GoalsService } from "../../goals/goals.service";
import type { TasksService } from "../../tasks/tasks.service";
import type { SchedulingService } from "../../scheduling/scheduling.service";
import { createGoalTools } from "./goals.tools";
import { createTaskTools } from "./tasks.tools";
import { createSchedulingTools } from "./scheduling.tools";

export function createTools(
  goalsService: GoalsService,
  tasksService: TasksService,
  schedulingService: SchedulingService,
) {
  return {
    ...createGoalTools(goalsService),
    ...createTaskTools(tasksService),
    ...createSchedulingTools(schedulingService),
  } as Record<string, any>;
}
```

- [ ] **Step 3: Run `tools.spec`**

Run: `pnpm --filter @consistent/core test -- tools.spec`

Expected: PASS (all 3 previously-failing tests now pass).

- [ ] **Step 4: Run full core test suite**

Run: `pnpm --filter @consistent/core test`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add "apps/core/src/ai/tools/index.ts"
git commit -m "feat(ai): wire all 16 tools in tools factory"
```

---

## Task 7: Coach system prompt module

**Files:**
- Create: `apps/core/src/ai/prompts/coach.ts`

- [ ] **Step 1: Create the prompt**

Create `apps/core/src/ai/prompts/coach.ts`:

```ts
export const COACH_SYSTEM_PROMPT = `You are a direct, high-agency productivity mentor talking to one person at a time. You write like a sharp friend who cares about their growth — warm but firm, specific not fluffy, happy to push when the user is coasting. Match the user's energy and language. Avoid corporate voice.

# Core loop

When the user shares a new goal, DO NOT immediately create records. First, interview them until you truly understand what they want:
- What does "done" look like? ("master Go" is vague — can they build a production HTTP service? contribute to the runtime? pass interview loops?)
- Timeline and current level
- Why this goal matters to them
- What they'll build or produce along the way

Only create the goal once you have enough signal to write tasks with real substance.

# Breaking goals into tasks

After the interview, decompose the goal into a DAG of tasks. For each task, decide:
- **title** — short, imperative, action-first ("Install Go and set up a workspace", not "Go setup")
- **description** — what's being done at a glance
- **context** — the *why*. What this task is, why it matters in the broader goal, and what the user should keep in mind while doing it. This is your coaching voice frozen into the record. Write 1-3 sentences. Example for "Install Go": "Foundation step — getting your toolchain healthy now saves hours of debugging later. Use the official installer, not your OS package manager; homebrew / apt builds tend to lag behind. Set GOPATH explicitly so it doesn't bite you when you start working across repos."
- **estimatedMinutes** — realistic time including mistakes
- **sprintPoints** — Fibonacci 1, 2, 3, 5, 8, 13. Guidance:
    - 1: trivial, <15min mental load
    - 2: straightforward, maybe slightly fiddly
    - 3: labor-intensive but not much thinking
    - 5: needs real focus; a morning's work
    - 8: complex enough to require planning before starting
    - 13: large-scale or deep thinking; probably decompose further if you can
- **dependencies** — use edges when task B genuinely can't start before task A finishes

Create all tasks in a single \`bulk-create-tasks\` call when possible. Show the plan to the user before celebrating — let them push back.

# Updating context as understanding evolves

When the user tells you something that changes how a task should be approached, update its \`context\`. This is load-bearing — later tasks depend on earlier context being correct. Treat the context field as a living coaching note.

# Delete confirmation

NEVER call delete-goal or delete-task on the first mention. Always state exactly what will be deleted and wait for an explicit "yes" in the next turn before calling. For update and status changes, no confirmation needed.

# Tone

- Drop the hedges ("I think maybe we could try"). Make calls.
- Push back on low-effort framing. "Learn Go" isn't a goal; extract the real one.
- Celebrate completed tasks briefly, then point at the next one.
- No em dashes. Short sentences. Use their language, not yours.`;
```

- [ ] **Step 2: Commit**

```bash
git add "apps/core/src/ai/prompts/coach.ts"
git commit -m "feat(ai): add coach system prompt"
```

---

## Task 8: Memory factory

**Files:**
- Create: `apps/core/src/ai/memory.ts`
- Create: `apps/core/src/ai/memory.spec.ts`

- [ ] **Step 1: Read embedded Mastra memory + pg docs**

```bash
grep -l "PgStore\|@mastra/pg" apps/core/node_modules/@mastra/pg/dist/*.d.ts
cat apps/core/node_modules/@mastra/pg/dist/index.d.ts | head -80
cat apps/core/node_modules/@mastra/memory/dist/index.d.ts | head -60
```

Confirm the `PgStore` constructor signature and `Memory` class shape. If the imports below don't match, adjust to match the installed version's exports.

- [ ] **Step 2: Write failing spec**

Create `apps/core/src/ai/memory.spec.ts`:

```ts
import { createMemory } from "./memory";

describe("createMemory", () => {
  it("returns an object with init + memory", () => {
    const { store, memory } = createMemory("postgres://x:y@localhost/z");
    expect(typeof store.init).toBe("function");
    expect(memory).toBeDefined();
  });
});
```

- [ ] **Step 3: Run, expect failure**

`pnpm --filter @consistent/core test -- memory.spec` → FAIL (module not found).

- [ ] **Step 4: Implement**

Create `apps/core/src/ai/memory.ts`:

```ts
import { Memory } from "@mastra/memory";
import { PgStore } from "@mastra/pg";

export interface CreatedMemory {
  store: PgStore;
  memory: Memory;
}

export function createMemory(connectionString: string): CreatedMemory {
  const store = new PgStore({
    connectionString,
    schemaName: "mastra",
  });
  const memory = new Memory({
    storage: store,
    options: { lastMessages: 40 },
  });
  return { store, memory };
}
```

If the actual exports differ (e.g. `PostgresStore` instead of `PgStore`, or `Memory` takes a different config), adjust to match the embedded d.ts. Re-run typecheck after.

- [ ] **Step 5: Run test, expect pass**

`pnpm --filter @consistent/core test -- memory.spec` → PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/core/src/ai/memory.ts" "apps/core/src/ai/memory.spec.ts"
git commit -m "feat(ai): add memory factory backed by Postgres in mastra schema"
```

---

## Task 9: Agent factory

**Files:**
- Create: `apps/core/src/ai/agent.ts`
- Create: `apps/core/src/ai/agent.spec.ts`

- [ ] **Step 1: Write failing spec**

Create `apps/core/src/ai/agent.spec.ts`:

```ts
import { createCoachAgent } from "./agent";

describe("createCoachAgent", () => {
  const stubTools = {
    "get-goals": { id: "get-goals" } as any,
  };
  const stubMemory = {} as any;

  it("builds an agent with the consistent-coach id", () => {
    const agent = createCoachAgent({
      tools: stubTools,
      memory: stubMemory,
      model: "openai/gpt-5.2",
    });
    expect((agent as any).id).toBe("consistent-coach");
  });

  it("instructions mention Fibonacci and delete confirmation", () => {
    const agent = createCoachAgent({
      tools: stubTools,
      memory: stubMemory,
      model: "openai/gpt-5.2",
    });
    const instructions = (agent as any).instructions as string;
    expect(instructions).toMatch(/Fibonacci/i);
    expect(instructions).toMatch(/confirm/i);
  });
});
```

- [ ] **Step 2: Run, expect failure**

`pnpm --filter @consistent/core test -- agent.spec` → FAIL.

- [ ] **Step 3: Implement**

Create `apps/core/src/ai/agent.ts`:

```ts
import { Agent } from "@mastra/core/agent";
import type { Memory } from "@mastra/memory";
import { COACH_SYSTEM_PROMPT } from "./prompts/coach";

export interface CoachAgentOptions {
  tools: Record<string, unknown>;
  memory: Memory;
  model: string;
}

export function createCoachAgent(opts: CoachAgentOptions): Agent {
  return new Agent({
    id: "consistent-coach",
    name: "Consistent Coach",
    instructions: COACH_SYSTEM_PROMPT,
    model: opts.model as any,
    tools: opts.tools as any,
    memory: opts.memory,
  });
}
```

If the `Agent` constructor doesn't accept `memory` as a top-level option in the installed version, check the embedded docs (`docs-memory-overview.md` / `docs-agents-overview.md`) and adjust.

- [ ] **Step 4: Run, expect pass**

`pnpm --filter @consistent/core test -- agent.spec` → PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/core/src/ai/agent.ts" "apps/core/src/ai/agent.spec.ts"
git commit -m "feat(ai): add consistent-coach agent factory"
```

---

## Task 10: Mastra factory (registers agent + routes + auth)

**Files:**
- Create: `apps/core/src/ai/mastra.ts`

- [ ] **Step 1: Read embedded docs on chatRoute + custom API routes**

Verify signatures:

```bash
cat apps/core/node_modules/@mastra/core/dist/docs/references/reference-ai-sdk-chat-route.md
cat apps/core/node_modules/@mastra/core/dist/docs/references/docs-server-custom-api-routes.md
cat apps/core/node_modules/@mastra/ai-sdk/dist/index.d.ts | head -40
cat apps/core/node_modules/@mastra/auth-better-auth/dist/index.d.ts | head -20
```

- [ ] **Step 2: Implement factory**

Create `apps/core/src/ai/mastra.ts`:

```ts
import { Mastra } from "@mastra/core";
import { chatRoute } from "@mastra/ai-sdk";
import { MastraAuthBetterAuth } from "@mastra/auth-better-auth";
import type { Agent } from "@mastra/core/agent";
import type { PgStore } from "@mastra/pg";
import { auth } from "@consistent/auth";

export function createMastra(agent: Agent, store: PgStore): Mastra {
  return new Mastra({
    agents: { "consistent-coach": agent },
    storage: store,
    server: {
      auth: new MastraAuthBetterAuth({ auth }),
      apiRoutes: [chatRoute({ path: "/chat/:agentId" })],
    },
  });
}
```

If `Mastra` takes `storage` at root or if the `server.auth` option requires different shape in the installed version, adjust to match embedded d.ts.

- [ ] **Step 3: Typecheck**

`pnpm --filter @consistent/core typecheck` → no errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/core/src/ai/mastra.ts"
git commit -m "feat(ai): add Mastra factory with chatRoute and Better Auth"
```

---

## Task 11: Express middleware for memory injection + ownership

**Files:**
- Create: `apps/core/src/ai/ai.middleware.ts`

- [ ] **Step 1: Implement the middleware**

Create `apps/core/src/ai/ai.middleware.ts`:

```ts
import type { Request, Response, NextFunction } from "express";
import { buildThreadId, isOwnedBy } from "./thread-id";

const RESOURCE_ID_KEY = "mastra__resourceId";

/**
 * Runs before chatRoute on /chat/*.
 * Reads resourceId from Mastra's requestContext (populated by MastraAuthBetterAuth).
 * Overwrites req.body.memory so clients cannot target another user's thread.
 * Accepts an optional body.threadSubId to allow future multi-thread support.
 */
export function chatMemoryGuard(req: Request, res: Response, next: NextFunction) {
  const requestContext = res.locals.requestContext as
    | { get: (k: string) => unknown }
    | undefined;
  const userId = requestContext?.get(RESOURCE_ID_KEY) as string | undefined;

  if (!userId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const subId = typeof body.threadSubId === "string" ? body.threadSubId : undefined;
  const thread = buildThreadId(userId, subId);

  // If client supplied a memory config, reject if it doesn't match.
  const clientMemory = body.memory as { thread?: string; resource?: string } | undefined;
  if (clientMemory?.thread && !isOwnedBy(clientMemory.thread, userId)) {
    res.status(403).json({ error: "thread not owned by authenticated user" });
    return;
  }

  body.memory = { resource: userId, thread };
  req.body = body;

  next();
}
```

Note: `res.locals.requestContext` is where `@mastra/express`'s context middleware stashes the context (see `apps/core/node_modules/@mastra/express/dist/index.d.ts` global augmentation). Verify this at implementation time.

- [ ] **Step 2: Typecheck**

`pnpm --filter @consistent/core typecheck` → no errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/core/src/ai/ai.middleware.ts"
git commit -m "feat(ai): add middleware to inject memory config server-side"
```

---

## Task 12: AI history controller

**Files:**
- Create: `apps/core/src/ai/ai.controller.ts`

- [ ] **Step 1: Implement controller**

Create `apps/core/src/ai/ai.controller.ts`:

```ts
import {
  Controller,
  Get,
  Inject,
  Param,
  UseGuards,
  ForbiddenException,
} from "@nestjs/common";
import type { Memory } from "@mastra/memory";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/auth.decorator";
import { isOwnedBy } from "./thread-id";

export const MEMORY = Symbol("MEMORY");

interface AuthUser {
  id: string;
}

@Controller({ version: "1", path: "ai" })
@UseGuards(AuthGuard)
export class AiController {
  constructor(@Inject(MEMORY) private readonly memory: Memory) {}

  @Get("threads/:threadId/messages")
  async getThreadMessages(
    @CurrentUser() user: AuthUser,
    @Param("threadId") threadId: string,
  ) {
    if (!isOwnedBy(threadId, user.id)) {
      throw new ForbiddenException("thread not owned by authenticated user");
    }

    const { messages } = await this.memory.query({
      threadId,
      resourceId: user.id,
    });

    return {
      messages: messages.map((m) => ({
        id: (m as any).id,
        role: (m as any).role,
        content: (m as any).content,
        createdAt: (m as any).createdAt,
      })),
    };
  }
}
```

If `memory.query({...})` returns a different shape in the installed version (confirmed via embedded docs), adjust the mapping.

- [ ] **Step 2: Typecheck**

`pnpm --filter @consistent/core typecheck` → no errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/core/src/ai/ai.controller.ts"
git commit -m "feat(ai): add GET /v1/ai/threads/:threadId/messages"
```

---

## Task 13: AI bootstrap service

**Files:**
- Create: `apps/core/src/ai/ai.bootstrap.ts`

- [ ] **Step 1: Implement bootstrap**

Create `apps/core/src/ai/ai.bootstrap.ts`:

```ts
import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  Logger,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { Application } from "express";
import { MastraServer } from "@mastra/express";
import type { Mastra } from "@mastra/core";
import type { PgStore } from "@mastra/pg";
import { chatMemoryGuard } from "./ai.middleware";

export const MASTRA = Symbol("MASTRA");
export const STORE = Symbol("STORE");

@Injectable()
export class MastraBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(MastraBootstrap.name);

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    @Inject(MASTRA) private readonly mastra: Mastra,
    @Inject(STORE) private readonly store: PgStore,
  ) {}

  async onApplicationBootstrap() {
    await this.store.init();
    this.logger.log("Mastra storage initialized (schema: mastra)");

    const express = this.httpAdapterHost.httpAdapter.getInstance() as Application;
    const server = new MastraServer(this.mastra);

    server.registerContextMiddleware();
    server.registerAuthMiddleware();
    express.use("/chat", chatMemoryGuard);
    await server.registerCustomApiRoutes();

    this.logger.log("Mastra chat routes mounted at /chat/*");
  }
}
```

**Note on MastraServer API:** the exact registration calls (`registerContextMiddleware`, etc.) come from `@mastra/express/dist/index.d.ts`. The constructor may take `(mastra, express)` instead — verify before running. If signatures differ, adjust and keep the intent: init store → mount context → mount auth → mount memory guard → mount chat routes.

- [ ] **Step 2: Typecheck**

`pnpm --filter @consistent/core typecheck` → no errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/core/src/ai/ai.bootstrap.ts"
git commit -m "feat(ai): add onApplicationBootstrap hook that mounts Mastra"
```

---

## Task 14: AI NestJS module

**Files:**
- Create: `apps/core/src/ai/ai.module.ts`
- Modify: `apps/core/src/app.module.ts`

- [ ] **Step 1: Create the module**

Create `apps/core/src/ai/ai.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { GoalsModule } from "../goals/goals.module";
import { TasksModule } from "../tasks/tasks.module";
import { SchedulingModule } from "../scheduling/scheduling.module";
import { GoalsService } from "../goals/goals.service";
import { TasksService } from "../tasks/tasks.service";
import { SchedulingService } from "../scheduling/scheduling.service";
import { env } from "../env";
import { createTools } from "./tools";
import { createMemory } from "./memory";
import { createCoachAgent } from "./agent";
import { createMastra } from "./mastra";
import { AiController, MEMORY } from "./ai.controller";
import { MastraBootstrap, MASTRA, STORE } from "./ai.bootstrap";

export const TOOLS = Symbol("TOOLS");
export const AGENT = Symbol("AGENT");

@Module({
  imports: [GoalsModule, TasksModule, SchedulingModule],
  controllers: [AiController],
  providers: [
    {
      provide: TOOLS,
      inject: [GoalsService, TasksService, SchedulingService],
      useFactory: (goals, tasks, scheduling) =>
        createTools(goals, tasks, scheduling),
    },
    {
      provide: STORE,
      useFactory: () => createMemory(env.DATABASE_URL).store,
    },
    {
      provide: MEMORY,
      useFactory: () => createMemory(env.DATABASE_URL).memory,
    },
    {
      provide: AGENT,
      inject: [TOOLS, MEMORY],
      useFactory: (tools, memory) =>
        createCoachAgent({ tools, memory, model: env.AI_MODEL }),
    },
    {
      provide: MASTRA,
      inject: [AGENT, STORE],
      useFactory: (agent, store) => createMastra(agent, store),
    },
    MastraBootstrap,
  ],
})
export class AiModule {}
```

Note: `createMemory` is called twice (once per provider). If this becomes a concern (e.g., two stores), extract a shared factory that memoizes the result for the DI layer.

- [ ] **Step 2: Import AiModule in AppModule**

Modify `apps/core/src/app.module.ts` — add `AiModule` to the `imports` array (read the file to find the right place).

- [ ] **Step 3: Typecheck**

`pnpm --filter @consistent/core typecheck` → no errors.

- [ ] **Step 4: Try starting the server briefly**

```bash
cd /Users/anubhav/Desktop/Projects/opensource/consistent && docker compose up -d
# Then, in apps/core:
cd apps/core && timeout 8 pnpm dev 2>&1 | tail -40
```

Expected: NestJS boots, logs "Mastra storage initialized" and "Mastra chat routes mounted at /chat/*". If it crashes on store.init(), check DB role permissions on schema creation.

- [ ] **Step 5: Commit**

```bash
git add "apps/core/src/ai/ai.module.ts" "apps/core/src/app.module.ts"
git commit -m "feat(ai): wire AiModule into AppModule"
```

---

## Task 15: AiModule integration test (stubbed model)

**Files:**
- Create: `apps/core/src/ai/ai.module.spec.ts`

- [ ] **Step 1: Write integration test**

Create `apps/core/src/ai/ai.module.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AiModule } from "./ai.module";
import { buildThreadId } from "./thread-id";

// Mock the DB barrel (same pattern as other specs)
jest.mock("../db", () => ({
  DRIZZLE: require("../db/types").DRIZZLE,
}));

describe("AiModule (integration)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Import the MEMORY symbol from the controller module so overrideProvider
    // targets the exact same token as AiModule's provider.
    const { MEMORY } = await import("./ai.controller");
    const moduleRef = await Test.createTestingModule({
      imports: [AiModule],
    })
      .overrideProvider(MEMORY)
      .useValue({ query: async () => ({ messages: [] }) })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => app?.close());

  it("GET /v1/ai/threads/:threadId/messages 401 without session", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/ai/threads/${buildThreadId("user-123")}/messages`);
    expect([401, 403]).toContain(res.status);
  });
});
```

If `supertest` isn't already a dep, skip this integration test for now — flagged in the spec's "out of scope for MVP deep testing". Alternatively, add supertest in this task's first step with `pnpm --filter @consistent/core add -D supertest @types/supertest`.

- [ ] **Step 2: Run**

`pnpm --filter @consistent/core test -- ai.module.spec` → should pass (or be skipped if supertest not installed; decide per the note above).

- [ ] **Step 3: Commit**

```bash
git add "apps/core/src/ai/ai.module.spec.ts" "apps/core/package.json" "pnpm-lock.yaml"
git commit -m "test(ai): add AiModule integration smoke test"
```

---

## Task 16: Install frontend dependencies

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Install**

```bash
pnpm --filter @consistent/web add @assistant-ui/react@^0.12.25 @assistant-ui/react-ai-sdk@^1.3.19
```

- [ ] **Step 2: Typecheck web**

`pnpm --filter @consistent/web typecheck` → no errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/package.json" "pnpm-lock.yaml"
git commit -m "chore(web): add assistant-ui packages"
```

---

## Task 17: Coach component

**Files:**
- Create: `apps/web/src/components/coach/history-adapter.ts`
- Create: `apps/web/src/components/coach/thread.tsx`
- Create: `apps/web/src/components/coach/coach.tsx`

- [ ] **Step 1: History adapter**

Create `apps/web/src/components/coach/history-adapter.ts`:

```ts
import { type ThreadHistoryAdapter } from "@assistant-ui/react";

export function createHistoryAdapter(
  apiUrl: string,
  threadId: string,
): ThreadHistoryAdapter {
  return {
    async load() {
      try {
        const res = await fetch(
          `${apiUrl}/v1/ai/threads/${encodeURIComponent(threadId)}/messages`,
          { credentials: "include" },
        );
        if (!res.ok) return { messages: [] };
        const data = (await res.json()) as {
          messages: Array<{
            id: string;
            role: "user" | "assistant" | "system";
            content: unknown;
            createdAt: string;
          }>;
        };
        return {
          messages: data.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content:
              typeof m.content === "string"
                ? [{ type: "text" as const, text: m.content }]
                : (m.content as any),
            createdAt: new Date(m.createdAt),
          })),
        };
      } catch {
        return { messages: [] };
      }
    },
    async append() {
      // no-op: server persists via chatRoute; double-writing would duplicate
    },
  };
}
```

The exact `ThreadHistoryAdapter` message shape comes from `@assistant-ui/react`. If types complain, adjust to the installed d.ts.

- [ ] **Step 2: Styled Thread wrapper**

Create `apps/web/src/components/coach/thread.tsx`:

```tsx
"use client";
import { Thread as UiThread } from "@assistant-ui/react";

export function Thread() {
  return (
    <div className="max-h-[240px] overflow-y-auto">
      <UiThread />
    </div>
  );
}
```

Match the visual language of the existing AIChatSection (compact pane, bg-card). Check `apps/web/src/app/(app)/page.tsx:741-820` for the container styling to mirror.

- [ ] **Step 3: Coach component**

Create `apps/web/src/components/coach/coach.tsx`:

```tsx
"use client";
import { useMemo } from "react";
import {
  AssistantRuntimeProvider,
  useChatRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import { useSession } from "@/lib/auth-client";
import { buildThreadId } from "./thread-id";
import { createHistoryAdapter } from "./history-adapter";
import { Thread } from "./thread";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export function Coach() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const threadId = userId ? buildThreadId(userId) : null;

  const runtime = useChatRuntime({
    transport: useMemo(
      () =>
        new AssistantChatTransport({
          api: `${API_URL}/chat/consistent-coach`,
          credentials: "include" as const,
        }),
      [],
    ),
    adapters: useMemo(
      () => ({
        history: threadId ? createHistoryAdapter(API_URL, threadId) : undefined,
      }),
      [threadId],
    ),
  });

  if (!userId) return null;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  );
}
```

Verify the actual exports of `useChatRuntime` + `AssistantChatTransport` from `@assistant-ui/react-ai-sdk@1.3.19` via `cat apps/web/node_modules/@assistant-ui/react-ai-sdk/dist/index.d.ts | head -80`. Adjust import paths if they differ.

- [ ] **Step 4: Typecheck**

`pnpm --filter @consistent/web typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/components/coach/history-adapter.ts" "apps/web/src/components/coach/thread.tsx" "apps/web/src/components/coach/coach.tsx"
git commit -m "feat(web): add Coach component with history adapter"
```

---

## Task 18: Replace canned AIChatSection in dashboard

**Files:**
- Modify: `apps/web/src/app/(app)/page.tsx`

- [ ] **Step 1: Read the current file**

Read `apps/web/src/app/(app)/page.tsx:1-60` and `741-830` to find:
- The `ChatMessage` type (~line 53)
- The `aiResponses` const (~line 60)
- The `AIChatSection` function (lines 741-~820)
- Where `<AIChatSection />` is mounted (~line 1017)

- [ ] **Step 2: Replace**

Make these edits:
1. Remove the `ChatMessage` interface.
2. Remove the `aiResponses` const.
3. Remove the entire `AIChatSection` function.
4. Add at the top of the file near other imports: `import { Coach } from "@/components/coach/coach";`
5. Replace `<AIChatSection />` with `<Coach />`.

(Do not remove the SectionLabel wrapper or the slot's surrounding markup — `Coach` renders inside that slot.)

If the slot wrapper lived inside `AIChatSection`, reintroduce it inline:

```tsx
<div>
  <SectionLabel>Assistant</SectionLabel>
  <div className="rounded-xl bg-card overflow-hidden">
    <Coach />
  </div>
</div>
```

- [ ] **Step 3: Remove unused imports**

If `useRef`, `useState`, `useEffect`, `useCallback`, `motion`, `easeOutExpo` (etc.) were only used by the removed chat, remove those imports. TypeScript will flag.

- [ ] **Step 4: Typecheck + build**

```bash
pnpm --filter @consistent/web typecheck
pnpm --filter @consistent/web build
```

Expected: both green.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(app)/page.tsx"
git commit -m "feat(web): replace canned AI chat with live Coach component"
```

---

## Task 19: Manual smoke test (no code)

This task has no code. Run through the checklist below and note any issues.

- [ ] **Step 1: Full-stack local boot**

```bash
docker compose up -d
pnpm db:migrate
pnpm --filter @consistent/core dev
# In another terminal:
pnpm --filter @consistent/web dev
```

- [ ] **Step 2: Interview flow**

1. Sign in at http://localhost:3000
2. In the Assistant pane, type: "Set up a goal to master Go"
3. Confirm: agent asks clarifying questions (does not immediately create a goal).
4. Answer with specifics. Confirm: agent eventually emits tool calls and creates goal + tasks.
5. Check the Goals panel on the dashboard: new goal appears without a manual refresh (realtime working).
6. Open Drizzle Studio (`pnpm db:studio`) → verify `tasks.sprint_points` and `tasks.context` are populated.

- [ ] **Step 3: Reload flow**

1. Refresh the browser.
2. Confirm: Assistant pane loads, auto-scrolls to the last exchange, older messages reachable by scrolling up.

- [ ] **Step 4: Delete flow**

1. Ask: "delete the Go goal".
2. Confirm: agent states what will be deleted and waits for "yes".
3. Send "yes". Confirm: goal disappears from the dashboard.

- [ ] **Step 5: Log findings**

If any step failed, open an issue describing the failure and link it from this task. If all passed, move to Task 20.

---

## Task 20: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.env.example`

- [ ] **Step 1: Update `.env.example`**

Add near the DATABASE_URL section:

```
# The DB role must have CREATE privilege on either the 'public' or 'mastra' schema.
# Mastra creates and owns the 'mastra' schema for agent thread memory.
```

Also confirm that `AI_MODEL`, `OPENAI_API_KEY` are listed with sensible defaults.

- [ ] **Step 2: Update `CLAUDE.md`**

Edits:
1. In "What's Not Built Yet" — remove "AI assistant backend (chat section is client-side canned responses)".
2. Add a new subsection under "Repository Structure" describing `apps/core/src/ai/`.
3. Under "API Endpoints" add `GET /v1/ai/threads/:threadId/messages` and `POST /chat/:agentId`.
4. Under "Gotchas" add: "Mastra memory lives in Postgres `mastra` schema (separate from Drizzle `public`). DB role needs CREATE privilege on the schema — see `.env.example`."

- [ ] **Step 3: Commit**

```bash
git add "CLAUDE.md" ".env.example"
git commit -m "docs: document AI assistant module and mastra schema requirement"
```

---

## Self-review checklist (before handing off)

- [ ] **Spec coverage**
  - Agent + 16 tools: Tasks 4–9 ✓
  - Memory in `mastra` schema: Tasks 8, 13, 20 ✓
  - Streaming via chatRoute: Tasks 10, 11, 13 ✓
  - Single persistent thread + history: Tasks 3, 11, 12, 17 ✓
  - Cross-user threadId guard: Tasks 11, 12 ✓
  - Mentor-coach prompt: Task 7 ✓
  - Fibonacci sprint points: Task 4 (tool schema `min(1).max(13)`) + Task 7 (prompt) ✓
  - Delete confirmation: Task 7 (prompt rule) + Tasks 4/5 (tool descriptions) ✓
  - Frontend replacement: Tasks 16–18 ✓
  - Env tightening: Task 2 ✓
  - Docs: Task 20 ✓

- [ ] **Placeholder scan**
  - No "TBD", no "implement later", no "similar to previous".
  - All code blocks complete.
  - Verification commands have expected outputs.

- [ ] **Type/name consistency**
  - `buildThreadId` used consistently across tasks 3, 11, 12, 17.
  - `MEMORY`, `MASTRA`, `STORE`, `TOOLS`, `AGENT` Symbol tokens consistent between module, controller, bootstrap.
  - `createTaskTools` / `createSchedulingTools` / `createGoalTools` consistent in tasks 4, 5, 6.
  - Tool IDs in specs match prompt's references (`bulk-create-tasks`, `delete-goal`, etc.).

- [ ] **Out-of-scope re-check**
  - No rate limiting, no multi-thread UI, no abort-through-service, no prompt evals. All in spec's deferred list.
