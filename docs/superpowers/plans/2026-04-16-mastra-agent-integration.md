# Mastra Agent Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate a Mastra AI agent into the NestJS backend (renamed from `apps/api` to `apps/core`), mounted on Express via `@mastra/express`, with full CRUD tools for goals/tasks/scheduling, and a frontend chat UI via assistant-ui.

**Architecture:** Mastra mounts on the shared Express instance at `/mastra/*` alongside NestJS (`/v1/*`) and Better Auth (`/api/auth/*`). Auth flows via `@mastra/auth-better-auth` using existing database sessions. Tools call NestJS services directly (in-process). Frontend uses `@assistant-ui/react` for the chat panel.

**Tech Stack:** Mastra (`@mastra/core`, `@mastra/express`, `@mastra/auth-better-auth`), Vercel AI SDK (`@ai-sdk/openai`), assistant-ui (`@assistant-ui/react`)

**Spec:** `docs/superpowers/specs/2026-04-16-mastra-agent-integration-design.md`

---

## File Map

### New files

```
apps/core/src/ai/
  ai.module.ts              — NestJS module, creates Mastra instance, mounts on Express via OnModuleInit
  ai.service.ts             — Injectable service for programmatic agent access (proactive triggers later)
  agent.ts                  — Agent definition (id, instructions, model, tools)
  tools/
    index.ts                — createTools() factory, captures NestJS services in closures
    goals.tools.ts          — get-goals, create-goal, update-goal, delete-goal
    tasks.tools.ts          — get-tasks, get-ready-tasks, get-goal-dag, create-task, bulk-create-tasks, update-task, delete-task
    schedule.tools.ts       — get-schedule, get-current-block, create-block, update-block, delete-block
  ai.service.spec.ts        — AiService unit tests
  tools/tools.spec.ts       — Tool factory + individual tool execute tests
```

### Modified files

```
apps/api/ → apps/core/                     — Directory rename
apps/core/package.json                     — name: @consistent/core, add Mastra + AI SDK deps
apps/core/src/env.ts                       — Add AI_MODEL, OPENAI_API_KEY
apps/core/src/app.module.ts                — Import AiModule
apps/core/src/main.ts                      — No changes needed (Mastra mounts via OnModuleInit)
apps/core/Dockerfile                       — Update turbo prune target + workdir
apps/web/package.json                      — Add @assistant-ui/react
apps/web/src/app/(app)/page.tsx            — Replace AIChatSection with assistant-ui
.env.example                               — Add AI_MODEL, OPENAI_API_KEY
turbo.json                                 — No changes (uses task names, not package names)
CLAUDE.md                                  — Update all apps/api references to apps/core
```

### Files that do NOT need changes

```
pnpm-workspace.yaml          — Uses apps/* glob, rename is transparent
turbo.json                   — References task names, not package names
root package.json             — Scripts use turbo (no --filter @consistent/api)
nest-cli.json                 — Moves with directory, no package name inside
docker-compose.yml            — Only defines postgres + redis, no app references
packages/*                    — No workspace imports of @consistent/api
```

---

## Task 1: Rename `apps/api` to `apps/core`

**Files:**
- Rename: `apps/api/` → `apps/core/`
- Modify: `apps/core/package.json`
- Modify: `apps/core/Dockerfile`

- [ ] **Step 1: Rename the directory**

```bash
cd /Users/anubhav/Desktop/Projects/opensource/consistent
git mv apps/api apps/core
```

- [ ] **Step 2: Update package name in `apps/core/package.json`**

Change the `name` field:

```json
"name": "@consistent/core"
```

- [ ] **Step 3: Update Dockerfile turbo prune target and workdir**

In `apps/core/Dockerfile`, change two lines:

```dockerfile
# In the pruner stage:
RUN turbo prune @consistent/core --docker

# In the runner stage:
WORKDIR /app/apps/core
```

- [ ] **Step 4: Reinstall to update lockfile**

```bash
pnpm install
```

The lockfile will update to reflect the new package name. The workspace glob (`apps/*`) picks up the renamed directory automatically.

- [ ] **Step 5: Verify build**

```bash
pnpm build
```

Expected: All packages and apps build successfully. The `@consistent/core` package resolves correctly.

- [ ] **Step 6: Verify tests**

```bash
pnpm --filter @consistent/core test
```

Expected: All existing tests pass unchanged.

- [ ] **Step 7: Commit**

```bash
git add apps/core/package.json apps/core/Dockerfile pnpm-lock.yaml
git commit -m "refactor: rename apps/api to apps/core"
```

Note: `git mv` in step 1 already staged the rename. This commit adds the modified files on top.

---

## Task 2: Install Mastra dependencies and add environment variables

**Files:**
- Modify: `apps/core/package.json`
- Modify: `apps/core/src/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: Install Mastra packages**

```bash
pnpm --filter @consistent/core add @mastra/core @mastra/express @mastra/auth-better-auth @ai-sdk/openai
```

- [ ] **Step 2: Verify packages installed**

```bash
ls apps/core/node_modules/@mastra/
```

Expected: `core/`, `express/`, `auth-better-auth/` directories present.

- [ ] **Step 3: Check embedded docs for current API**

Before writing any code, verify the exact constructor signatures against the installed version:

```bash
grep -r "Agent" apps/core/node_modules/@mastra/core/dist/docs/references/ 2>/dev/null | head -20
grep -r "createTool" apps/core/node_modules/@mastra/core/dist/docs/references/ 2>/dev/null | head -20
grep -r "MastraServer" apps/core/node_modules/@mastra/express/dist/docs/references/ 2>/dev/null | head -20
grep -r "MastraAuthBetterAuth" apps/core/node_modules/@mastra/auth-better-auth/dist/docs/references/ 2>/dev/null | head -20
```

If embedded docs exist, use those exact signatures in subsequent tasks. If not, fall back to the remote docs findings in the spec. Adapt all code in subsequent tasks to match the installed version.

- [ ] **Step 4: Add AI environment variables to `apps/core/src/env.ts`**

Current file:

```typescript
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
  },
  runtimeEnv: process.env,
});
```

Add after `PORT`:

```typescript
    AI_MODEL: z.string().default("openai/gpt-4o"),
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
```

- [ ] **Step 5: Update `.env.example`**

Add at the end:

```
# AI Agent
AI_MODEL=openai/gpt-4o
OPENAI_API_KEY=your-openai-api-key
```

- [ ] **Step 6: Add your real API key to `.env`**

```bash
# Add to your .env (NOT committed):
# OPENAI_API_KEY=sk-...
```

- [ ] **Step 7: Verify build with new deps**

```bash
pnpm --filter @consistent/core build
```

Expected: Build succeeds. The new deps are compatible with ESM + bundler moduleResolution.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(core): install Mastra dependencies and add AI env vars" -- apps/core/package.json apps/core/src/env.ts .env.example pnpm-lock.yaml
```

---

## Task 3: Create tool factory and goal tools

**Files:**
- Create: `apps/core/src/ai/tools/goals.tools.ts`
- Create: `apps/core/src/ai/tools/index.ts`
- Create: `apps/core/src/ai/tools/tools.spec.ts`

- [ ] **Step 1: Write failing tests for goal tools**

Create `apps/core/src/ai/tools/tools.spec.ts`:

```typescript
import { GoalsService } from "../../goals/goals.service";
import { TasksService } from "../../tasks/tasks.service";
import { SchedulingService } from "../../scheduling/scheduling.service";
import { createTools } from "./index";

describe("createTools", () => {
  const mockGoalsService = {
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    getProgress: jest.fn(),
  } as unknown as GoalsService;

  const mockTasksService = {
    findAllForGoal: jest.fn(),
    findReadyForUser: jest.fn(),
    getGoalDag: jest.fn(),
    create: jest.fn(),
    bulkCreate: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  } as unknown as TasksService;

  const mockSchedulingService = {
    getBlocksForRange: jest.fn(),
    getCurrentBlock: jest.fn(),
    createBlock: jest.fn(),
    updateBlockStatus: jest.fn(),
    deleteBlock: jest.fn(),
  } as unknown as SchedulingService;

  const tools = createTools(mockGoalsService, mockTasksService, mockSchedulingService);

  it("should create all 16 tools", () => {
    expect(Object.keys(tools)).toHaveLength(16);
  });

  it("should include all goal tools", () => {
    expect(tools["get-goals"]).toBeDefined();
    expect(tools["create-goal"]).toBeDefined();
    expect(tools["update-goal"]).toBeDefined();
    expect(tools["delete-goal"]).toBeDefined();
  });

  it("should include all task tools", () => {
    expect(tools["get-tasks"]).toBeDefined();
    expect(tools["get-ready-tasks"]).toBeDefined();
    expect(tools["get-goal-dag"]).toBeDefined();
    expect(tools["create-task"]).toBeDefined();
    expect(tools["bulk-create-tasks"]).toBeDefined();
    expect(tools["update-task"]).toBeDefined();
    expect(tools["delete-task"]).toBeDefined();
  });

  it("should include all schedule tools", () => {
    expect(tools["get-schedule"]).toBeDefined();
    expect(tools["get-current-block"]).toBeDefined();
    expect(tools["create-block"]).toBeDefined();
    expect(tools["update-block"]).toBeDefined();
    expect(tools["delete-block"]).toBeDefined();
  });
});

describe("goal tool execution", () => {
  const mockGoalsService = {
    findAll: jest.fn().mockResolvedValue([
      { id: 1, title: "Test Goal", progress: 50 },
    ]),
    create: jest.fn().mockResolvedValue({ id: 1, title: "New Goal" }),
    update: jest.fn().mockResolvedValue({ id: 1, title: "Updated Goal" }),
    delete: jest.fn().mockResolvedValue(undefined),
  } as unknown as GoalsService;

  const mockTasksService = {} as unknown as TasksService;
  const mockSchedulingService = {} as unknown as SchedulingService;

  const tools = createTools(mockGoalsService, mockTasksService, mockSchedulingService);

  const mockContext = {
    requestContext: new Map([["resourceId", "user-123"]]),
  } as any;

  beforeEach(() => jest.clearAllMocks());

  it("get-goals should call goalsService.findAll with userId", async () => {
    const result = await tools["get-goals"].execute({ status: "active" }, mockContext);
    expect(mockGoalsService.findAll).toHaveBeenCalledWith("user-123", "active");
    expect(result).toEqual({ goals: [{ id: 1, title: "Test Goal", progress: 50 }] });
  });

  it("create-goal should call goalsService.create with userId and data", async () => {
    const input = { title: "New Goal", description: "A goal" };
    await tools["create-goal"].execute(input, mockContext);
    expect(mockGoalsService.create).toHaveBeenCalledWith("user-123", input);
  });

  it("delete-goal should call goalsService.delete with userId and goalId", async () => {
    await tools["delete-goal"].execute({ goalId: 1 }, mockContext);
    expect(mockGoalsService.delete).toHaveBeenCalledWith("user-123", 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @consistent/core test -- --testPathPattern='tools.spec'
```

Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 3: Create goal tools in `apps/core/src/ai/tools/goals.tools.ts`**

```typescript
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { GoalsService } from "../../goals/goals.service";

export function createGoalTools(goalsService: GoalsService) {
  const getGoals = createTool({
    id: "get-goals",
    description: "Get all goals for the current user with progress percentages. Use this to understand what the user is working toward.",
    inputSchema: z.object({
      status: z.enum(["active", "completed", "paused", "abandoned"]).optional().describe("Filter by status. Omit to get all goals."),
    }),
    outputSchema: z.object({ goals: z.array(z.any()) }),
    execute: async (input, context) => {
      const userId = context.requestContext.get("resourceId") as string;
      const goals = await goalsService.findAll(userId, input.status);
      return { goals };
    },
  });

  const createGoal = createTool({
    id: "create-goal",
    description: "Create a new goal for the user. Ask the user for a title before calling this.",
    inputSchema: z.object({
      title: z.string().describe("The goal title"),
      description: z.string().nullable().optional().describe("Longer description of the goal"),
      context: z.string().nullable().optional().describe("Additional context"),
      color: z.string().nullable().optional().describe("Hex color code for UI display"),
      targetDate: z.string().nullable().optional().describe("Target completion date (ISO 8601)"),
      priority: z.number().optional().describe("Priority 1-5, lower is higher priority"),
    }),
    outputSchema: z.object({ goal: z.any() }),
    execute: async (input, context) => {
      const userId = context.requestContext.get("resourceId") as string;
      const goal = await goalsService.create(userId, input);
      return { goal };
    },
  });

  const updateGoal = createTool({
    id: "update-goal",
    description: "Update an existing goal's title, description, status, or other fields.",
    inputSchema: z.object({
      goalId: z.number().describe("The goal ID to update"),
      title: z.string().optional(),
      description: z.string().nullable().optional(),
      context: z.string().nullable().optional(),
      color: z.string().nullable().optional(),
      status: z.enum(["active", "completed", "paused", "abandoned"]).optional(),
      targetDate: z.string().nullable().optional(),
      priority: z.number().optional(),
    }),
    outputSchema: z.object({ goal: z.any() }),
    execute: async (input, context) => {
      const userId = context.requestContext.get("resourceId") as string;
      const { goalId, ...data } = input;
      const goal = await goalsService.update(userId, goalId, data);
      return { goal };
    },
  });

  const deleteGoal = createTool({
    id: "delete-goal",
    description: "Permanently delete a goal and all its tasks. Always confirm with the user before calling this.",
    inputSchema: z.object({
      goalId: z.number().describe("The goal ID to delete"),
    }),
    outputSchema: z.object({ success: z.boolean() }),
    execute: async (input, context) => {
      const userId = context.requestContext.get("resourceId") as string;
      await goalsService.delete(userId, input.goalId);
      return { success: true };
    },
  });

  return { "get-goals": getGoals, "create-goal": createGoal, "update-goal": updateGoal, "delete-goal": deleteGoal };
}
```

- [ ] **Step 4: Create tool factory barrel in `apps/core/src/ai/tools/index.ts`**

```typescript
import type { GoalsService } from "../../goals/goals.service";
import type { TasksService } from "../../tasks/tasks.service";
import type { SchedulingService } from "../../scheduling/scheduling.service";
import { createGoalTools } from "./goals.tools";

export function createTools(
  goalsService: GoalsService,
  tasksService: TasksService,
  schedulingService: SchedulingService,
) {
  return {
    ...createGoalTools(goalsService),
    // Task and schedule tools added in subsequent tasks
  } as Record<string, any>;
}
```

Note: The return type uses `Record<string, any>` temporarily. After all tool files are created in Tasks 4 and 5, the type will be inferred from the spread.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @consistent/core test -- --testPathPattern='tools.spec'
```

Expected: The goal tool tests and the `should include all goal tools` test pass. The count test (expects 16) and task/schedule tool existence tests fail — that's correct, those tools don't exist yet.

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/ai/tools/goals.tools.ts apps/core/src/ai/tools/index.ts apps/core/src/ai/tools/tools.spec.ts
git commit -m "feat(ai): create tool factory and goal tools with tests"
```

---

## Task 4: Create task tools

**Files:**
- Create: `apps/core/src/ai/tools/tasks.tools.ts`
- Modify: `apps/core/src/ai/tools/index.ts`

- [ ] **Step 1: Add task tool execution tests to `tools.spec.ts`**

Append to `apps/core/src/ai/tools/tools.spec.ts`:

```typescript
describe("task tool execution", () => {
  const mockGoalsService = {} as unknown as GoalsService;

  const mockTasksService = {
    findAllForGoal: jest.fn().mockResolvedValue([{ id: 1, title: "Task 1" }]),
    findReadyForUser: jest.fn().mockResolvedValue([{ id: 2, title: "Ready Task" }]),
    getGoalDag: jest.fn().mockResolvedValue({ nodes: [], edges: [] }),
    create: jest.fn().mockResolvedValue({ id: 3, title: "New Task" }),
    bulkCreate: jest.fn().mockResolvedValue([{ id: 4 }, { id: 5 }]),
    update: jest.fn().mockResolvedValue({ id: 1, status: "completed" }),
    delete: jest.fn().mockResolvedValue(undefined),
  } as unknown as TasksService;

  const mockSchedulingService = {} as unknown as SchedulingService;

  const tools = createTools(mockGoalsService, mockTasksService, mockSchedulingService);

  const mockContext = {
    requestContext: new Map([["resourceId", "user-123"]]),
  } as any;

  beforeEach(() => jest.clearAllMocks());

  it("get-tasks should call tasksService.findAllForGoal", async () => {
    await tools["get-tasks"].execute({ goalId: 1 }, mockContext);
    expect(mockTasksService.findAllForGoal).toHaveBeenCalledWith("user-123", 1);
  });

  it("get-ready-tasks should call tasksService.findReadyForUser", async () => {
    await tools["get-ready-tasks"].execute({}, mockContext);
    expect(mockTasksService.findReadyForUser).toHaveBeenCalledWith("user-123");
  });

  it("create-task should call tasksService.create", async () => {
    const input = { goalId: 1, title: "New Task" };
    await tools["create-task"].execute(input, mockContext);
    expect(mockTasksService.create).toHaveBeenCalledWith("user-123", 1, { title: "New Task" });
  });

  it("bulk-create-tasks should call tasksService.bulkCreate", async () => {
    const input = {
      goalId: 1,
      tasks: [{ title: "Task A" }, { title: "Task B" }],
      dependencies: [{ fromIndex: 1, toIndex: 0 }],
    };
    await tools["bulk-create-tasks"].execute(input, mockContext);
    expect(mockTasksService.bulkCreate).toHaveBeenCalledWith("user-123", 1, {
      tasks: [{ title: "Task A" }, { title: "Task B" }],
      dependencies: [{ fromIndex: 1, toIndex: 0 }],
    });
  });

  it("update-task should call tasksService.update", async () => {
    await tools["update-task"].execute({ taskId: 1, status: "completed" }, mockContext);
    expect(mockTasksService.update).toHaveBeenCalledWith("user-123", 1, { status: "completed" });
  });

  it("delete-task should call tasksService.delete", async () => {
    await tools["delete-task"].execute({ taskId: 1 }, mockContext);
    expect(mockTasksService.delete).toHaveBeenCalledWith("user-123", 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @consistent/core test -- --testPathPattern='tools.spec'
```

Expected: New task tool tests fail — `tools["get-tasks"]` is undefined.

- [ ] **Step 3: Create task tools in `apps/core/src/ai/tools/tasks.tools.ts`**

```typescript
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { TasksService } from "../../tasks/tasks.service";

export function createTaskTools(tasksService: TasksService) {
  const getTasks = createTool({
    id: "get-tasks",
    description: "Get all tasks for a specific goal. Shows task status, blockers, and dependencies.",
    inputSchema: z.object({
      goalId: z.number().describe("The goal ID to list tasks for"),
    }),
    outputSchema: z.object({ tasks: z.array(z.any()) }),
    execute: async (input, context) => {
      const userId = context.requestContext.get("resourceId") as string;
      const tasks = await tasksService.findAllForGoal(userId, input.goalId);
      return { tasks };
    },
  });

  const getReadyTasks = createTool({
    id: "get-ready-tasks",
    description: "Find all unblocked pending tasks across all goals. These are tasks the user can work on right now.",
    inputSchema: z.object({}),
    outputSchema: z.object({ tasks: z.array(z.any()) }),
    execute: async (_input, context) => {
      const userId = context.requestContext.get("resourceId") as string;
      const tasks = await tasksService.findReadyForUser(userId);
      return { tasks };
    },
  });

  const getGoalDag = createTool({
    id: "get-goal-dag",
    description: "Get the dependency graph (DAG) for a goal. Shows which tasks block which other tasks.",
    inputSchema: z.object({
      goalId: z.number().describe("The goal ID"),
    }),
    outputSchema: z.object({ dag: z.any() }),
    execute: async (input, context) => {
      const userId = context.requestContext.get("resourceId") as string;
      const dag = await tasksService.getGoalDag(userId, input.goalId);
      return { dag };
    },
  });

  const createTask = createTool({
    id: "create-task",
    description: "Create a single task under a goal.",
    inputSchema: z.object({
      goalId: z.number().describe("The goal this task belongs to"),
      title: z.string().describe("The task title"),
      description: z.string().nullable().optional(),
      context: z.string().nullable().optional(),
      estimatedMinutes: z.number().nullable().optional().describe("Estimated time to complete in minutes"),
      priority: z.number().optional().describe("Priority 1-5, lower is higher"),
    }),
    outputSchema: z.object({ task: z.any() }),
    execute: async (input, context) => {
      const userId = context.requestContext.get("resourceId") as string;
      const { goalId, ...data } = input;
      const task = await tasksService.create(userId, goalId, data);
      return { task };
    },
  });

  const bulkCreateTasks = createTool({
    id: "bulk-create-tasks",
    description: "Break down a goal into multiple tasks with dependency relationships. Use this when the user wants you to plan out a goal. Dependencies use index-based references: fromIndex depends on toIndex.",
    inputSchema: z.object({
      goalId: z.number().describe("The goal to create tasks under"),
      tasks: z.array(z.object({
        title: z.string(),
        description: z.string().nullable().optional(),
        context: z.string().nullable().optional(),
        estimatedMinutes: z.number().nullable().optional(),
        priority: z.number().optional(),
      })).describe("Array of tasks to create"),
      dependencies: z.array(z.object({
        fromIndex: z.number().describe("Index of the dependent task (the one that waits)"),
        toIndex: z.number().describe("Index of the dependency (the one that must finish first)"),
        type: z.enum(["finish_to_start", "start_to_start", "finish_to_finish", "start_to_finish"]).optional(),
        lagMinutes: z.number().optional(),
      })).optional().describe("Dependency edges between tasks by array index"),
    }),
    outputSchema: z.object({ tasks: z.array(z.any()) }),
    execute: async (input, context) => {
      const userId = context.requestContext.get("resourceId") as string;
      const { goalId, ...data } = input;
      const tasks = await tasksService.bulkCreate(userId, goalId, data);
      return { tasks };
    },
  });

  const updateTask = createTool({
    id: "update-task",
    description: "Update a task's status, title, or other fields. Use this to mark tasks as completed, in_progress, etc.",
    inputSchema: z.object({
      taskId: z.number().describe("The task ID to update"),
      title: z.string().optional(),
      description: z.string().nullable().optional(),
      context: z.string().nullable().optional(),
      status: z.enum(["pending", "ready", "scheduled", "in_progress", "completed", "blocked", "cancelled"]).optional(),
      estimatedMinutes: z.number().nullable().optional(),
      actualMinutes: z.number().nullable().optional(),
      priority: z.number().optional(),
    }),
    outputSchema: z.object({ task: z.any() }),
    execute: async (input, context) => {
      const userId = context.requestContext.get("resourceId") as string;
      const { taskId, ...data } = input;
      const task = await tasksService.update(userId, taskId, data);
      return { task };
    },
  });

  const deleteTask = createTool({
    id: "delete-task",
    description: "Permanently delete a task. Always confirm with the user before calling this.",
    inputSchema: z.object({
      taskId: z.number().describe("The task ID to delete"),
    }),
    outputSchema: z.object({ success: z.boolean() }),
    execute: async (input, context) => {
      const userId = context.requestContext.get("resourceId") as string;
      await tasksService.delete(userId, input.taskId);
      return { success: true };
    },
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

- [ ] **Step 4: Update `apps/core/src/ai/tools/index.ts` to include task tools**

```typescript
import type { GoalsService } from "../../goals/goals.service";
import type { TasksService } from "../../tasks/tasks.service";
import type { SchedulingService } from "../../scheduling/scheduling.service";
import { createGoalTools } from "./goals.tools";
import { createTaskTools } from "./tasks.tools";

export function createTools(
  goalsService: GoalsService,
  tasksService: TasksService,
  schedulingService: SchedulingService,
) {
  return {
    ...createGoalTools(goalsService),
    ...createTaskTools(tasksService),
    // Schedule tools added in next task
  } as Record<string, any>;
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @consistent/core test -- --testPathPattern='tools.spec'
```

Expected: Goal and task tool tests pass. Schedule tool existence tests still fail (expected).

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/ai/tools/tasks.tools.ts apps/core/src/ai/tools/index.ts apps/core/src/ai/tools/tools.spec.ts
git commit -m "feat(ai): create task tools with tests"
```

---

## Task 5: Create schedule tools

**Files:**
- Create: `apps/core/src/ai/tools/schedule.tools.ts`
- Modify: `apps/core/src/ai/tools/index.ts`
- Modify: `apps/core/src/ai/tools/tools.spec.ts`

- [ ] **Step 1: Add schedule tool execution tests to `tools.spec.ts`**

Append to `apps/core/src/ai/tools/tools.spec.ts`:

```typescript
describe("schedule tool execution", () => {
  const mockGoalsService = {} as unknown as GoalsService;
  const mockTasksService = {} as unknown as TasksService;

  const mockSchedulingService = {
    getBlocksForRange: jest.fn().mockResolvedValue([{ id: 1, taskId: 1, startTime: "2026-04-16T09:00:00Z" }]),
    getCurrentBlock: jest.fn().mockResolvedValue({ id: 1, taskId: 1 }),
    createBlock: jest.fn().mockResolvedValue({ id: 2, taskId: 3 }),
    updateBlockStatus: jest.fn().mockResolvedValue({ id: 1, status: "completed" }),
    deleteBlock: jest.fn().mockResolvedValue(undefined),
  } as unknown as SchedulingService;

  const tools = createTools(mockGoalsService, mockTasksService, mockSchedulingService);

  const mockContext = {
    requestContext: new Map([["resourceId", "user-123"]]),
  } as any;

  beforeEach(() => jest.clearAllMocks());

  it("get-schedule should call schedulingService.getBlocksForRange", async () => {
    await tools["get-schedule"].execute(
      { start: "2026-04-16T00:00:00Z", end: "2026-04-16T23:59:59Z" },
      mockContext,
    );
    expect(mockSchedulingService.getBlocksForRange).toHaveBeenCalledWith(
      "user-123",
      new Date("2026-04-16T00:00:00Z"),
      new Date("2026-04-16T23:59:59Z"),
    );
  });

  it("get-current-block should call schedulingService.getCurrentBlock", async () => {
    await tools["get-current-block"].execute({}, mockContext);
    expect(mockSchedulingService.getCurrentBlock).toHaveBeenCalledWith("user-123");
  });

  it("create-block should call schedulingService.createBlock", async () => {
    await tools["create-block"].execute(
      { taskId: 3, startTime: "2026-04-16T09:00:00Z", endTime: "2026-04-16T10:00:00Z" },
      mockContext,
    );
    expect(mockSchedulingService.createBlock).toHaveBeenCalledWith("user-123", {
      taskId: 3,
      startTime: new Date("2026-04-16T09:00:00Z"),
      endTime: new Date("2026-04-16T10:00:00Z"),
      scheduledBy: "llm",
    });
  });

  it("delete-block should call schedulingService.deleteBlock", async () => {
    await tools["delete-block"].execute({ blockId: 1 }, mockContext);
    expect(mockSchedulingService.deleteBlock).toHaveBeenCalledWith("user-123", 1);
  });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

```bash
pnpm --filter @consistent/core test -- --testPathPattern='tools.spec'
```

Expected: Schedule tool tests fail — `tools["get-schedule"]` is undefined.

- [ ] **Step 3: Create schedule tools in `apps/core/src/ai/tools/schedule.tools.ts`**

```typescript
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { SchedulingService } from "../../scheduling/scheduling.service";

export function createScheduleTools(schedulingService: SchedulingService) {
  const getSchedule = createTool({
    id: "get-schedule",
    description: "Get scheduled time blocks for a date range. Each block shows which task is scheduled and when.",
    inputSchema: z.object({
      start: z.string().describe("Start of range (ISO 8601 datetime)"),
      end: z.string().describe("End of range (ISO 8601 datetime)"),
    }),
    outputSchema: z.object({ blocks: z.array(z.any()) }),
    execute: async (input, context) => {
      const userId = context.requestContext.get("resourceId") as string;
      const blocks = await schedulingService.getBlocksForRange(
        userId,
        new Date(input.start),
        new Date(input.end),
      );
      return { blocks };
    },
  });

  const getCurrentBlock = createTool({
    id: "get-current-block",
    description: "Get the currently active schedule block — what the user should be working on right now.",
    inputSchema: z.object({}),
    outputSchema: z.object({ block: z.any().nullable() }),
    execute: async (_input, context) => {
      const userId = context.requestContext.get("resourceId") as string;
      const block = await schedulingService.getCurrentBlock(userId);
      return { block };
    },
  });

  const createBlock = createTool({
    id: "create-block",
    description: "Schedule a time block for a task. The block defines when the user should work on the task.",
    inputSchema: z.object({
      taskId: z.number().describe("The task to schedule"),
      startTime: z.string().describe("Block start time (ISO 8601)"),
      endTime: z.string().describe("Block end time (ISO 8601)"),
    }),
    outputSchema: z.object({ block: z.any() }),
    execute: async (input, context) => {
      const userId = context.requestContext.get("resourceId") as string;
      const block = await schedulingService.createBlock(userId, {
        taskId: input.taskId,
        startTime: new Date(input.startTime),
        endTime: new Date(input.endTime),
        scheduledBy: "llm",
      });
      return { block };
    },
  });

  const updateBlock = createTool({
    id: "update-block",
    description: "Update a schedule block's status (e.g., mark as completed, missed, or moved).",
    inputSchema: z.object({
      blockId: z.number().describe("The block ID to update"),
      status: z.enum(["planned", "confirmed", "completed", "missed", "moved"]).describe("New status"),
    }),
    outputSchema: z.object({ block: z.any() }),
    execute: async (input, context) => {
      const userId = context.requestContext.get("resourceId") as string;
      const block = await schedulingService.updateBlockStatus(userId, input.blockId, input.status);
      return { block };
    },
  });

  const deleteBlock = createTool({
    id: "delete-block",
    description: "Delete a scheduled block. Confirm with the user before calling this.",
    inputSchema: z.object({
      blockId: z.number().describe("The block ID to delete"),
    }),
    outputSchema: z.object({ success: z.boolean() }),
    execute: async (input, context) => {
      const userId = context.requestContext.get("resourceId") as string;
      await schedulingService.deleteBlock(userId, input.blockId);
      return { success: true };
    },
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

- [ ] **Step 4: Update `apps/core/src/ai/tools/index.ts` to include schedule tools**

```typescript
import type { GoalsService } from "../../goals/goals.service";
import type { TasksService } from "../../tasks/tasks.service";
import type { SchedulingService } from "../../scheduling/scheduling.service";
import { createGoalTools } from "./goals.tools";
import { createTaskTools } from "./tasks.tools";
import { createScheduleTools } from "./schedule.tools";

export function createTools(
  goalsService: GoalsService,
  tasksService: TasksService,
  schedulingService: SchedulingService,
) {
  return {
    ...createGoalTools(goalsService),
    ...createTaskTools(tasksService),
    ...createScheduleTools(schedulingService),
  };
}
```

- [ ] **Step 5: Run all tool tests**

```bash
pnpm --filter @consistent/core test -- --testPathPattern='tools.spec'
```

Expected: All 16 tool existence tests pass. All execution tests pass. The count test (`should create all 16 tools`) passes.

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/ai/tools/schedule.tools.ts apps/core/src/ai/tools/index.ts apps/core/src/ai/tools/tools.spec.ts
git commit -m "feat(ai): create schedule tools, complete tool inventory"
```

---

## Task 6: Create agent definition

**Files:**
- Create: `apps/core/src/ai/agent.ts`

- [ ] **Step 1: Check Mastra model router docs**

Verify the model configuration API against installed docs:

```bash
grep -r "model" apps/core/node_modules/@mastra/core/dist/docs/references/ 2>/dev/null | head -10
```

Adapt the model setup in step 2 if the API differs from what's shown below.

- [ ] **Step 2: Create agent definition in `apps/core/src/ai/agent.ts`**

```typescript
import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { env } from "../env";

export function createAgent(tools: Record<string, any>) {
  return new Agent({
    id: "consistent-agent",
    name: "Consistent",
    model: openai(env.AI_MODEL.replace("openai/", "")),
    instructions: () => `You are Consistent, a productivity assistant. You help users break down goals into actionable tasks, manage task dependencies, schedule work blocks, and stay motivated.

Current time: ${new Date().toISOString()}

Your capabilities:
- View and create goals with progress tracking
- Break down goals into tasks with dependency relationships (DAG)
- Find which tasks are ready to work on (unblocked)
- Schedule time blocks for tasks
- Check what the user should be working on right now
- Mark tasks as complete and track progress
- Delete goals, tasks, or schedule blocks when asked

Guidelines:
- Always check the user's current goals and progress before making suggestions
- When breaking down a goal, create tasks with clear dependencies using bulk-create-tasks
- Before deleting anything, confirm with the user first
- When scheduling blocks, check existing schedule to avoid conflicts
- Be encouraging but concise — focus on actionable next steps
- If the user seems stuck, suggest their ready tasks or help prioritize`,
    tools,
  });
}
```

Note: The model initialization shown above assumes `AI_MODEL` is in `"openai/gpt-4o"` format. The `openai()` function from `@ai-sdk/openai` takes just the model name (e.g., `"gpt-4o"`). If using Mastra's model router instead of direct AI SDK usage, consult the embedded docs and adapt — the model router takes the full `"provider/model-name"` string directly.

- [ ] **Step 3: Commit**

```bash
git add apps/core/src/ai/agent.ts
git commit -m "feat(ai): create agent definition with instructions and model config"
```

---

## Task 7: Create AiModule, AiService, and wire into AppModule

**Files:**
- Create: `apps/core/src/ai/ai.service.ts`
- Create: `apps/core/src/ai/ai.module.ts`
- Create: `apps/core/src/ai/ai.service.spec.ts`
- Modify: `apps/core/src/app.module.ts`

- [ ] **Step 1: Write failing test for AiService**

Create `apps/core/src/ai/ai.service.spec.ts`:

```typescript
import { AiService } from "./ai.service";

describe("AiService", () => {
  it("should be defined", () => {
    const service = new AiService();
    expect(service).toBeDefined();
  });

  it("should expose getAgent method", () => {
    const service = new AiService();
    expect(typeof service.getAgent).toBe("function");
  });

  it("should return null before initialization", () => {
    const service = new AiService();
    expect(service.getAgent()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @consistent/core test -- --testPathPattern='ai.service.spec'
```

Expected: FAIL — `Cannot find module './ai.service'`

- [ ] **Step 3: Create `apps/core/src/ai/ai.service.ts`**

```typescript
import { Injectable } from "@nestjs/common";
import type { Agent } from "@mastra/core/agent";

@Injectable()
export class AiService {
  private agent: Agent | null = null;

  setAgent(agent: Agent) {
    this.agent = agent;
  }

  getAgent(): Agent | null {
    return this.agent;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @consistent/core test -- --testPathPattern='ai.service.spec'
```

Expected: PASS

- [ ] **Step 5: Create `apps/core/src/ai/ai.module.ts`**

```typescript
import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Mastra } from "@mastra/core";
import { MastraServer } from "@mastra/express";
import { MastraAuthBetterAuth } from "@mastra/auth-better-auth";
import { auth } from "@consistent/auth";
import { GoalsService } from "../goals/goals.service";
import { TasksService } from "../tasks/tasks.service";
import { SchedulingService } from "../scheduling/scheduling.service";
import { GoalsModule } from "../goals/goals.module";
import { TasksModule } from "../tasks/tasks.module";
import { SchedulingModule } from "../scheduling/scheduling.module";
import { createTools } from "./tools";
import { createAgent } from "./agent";
import { AiService } from "./ai.service";

@Module({
  imports: [GoalsModule, TasksModule, SchedulingModule],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule implements OnModuleInit {
  private readonly logger = new Logger(AiModule.name);

  constructor(
    private readonly goalsService: GoalsService,
    private readonly tasksService: TasksService,
    private readonly schedulingService: SchedulingService,
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly aiService: AiService,
  ) {}

  async onModuleInit() {
    const tools = createTools(
      this.goalsService,
      this.tasksService,
      this.schedulingService,
    );

    const agent = createAgent(tools);
    this.aiService.setAgent(agent);

    const mastra = new Mastra({
      agents: { [agent.id]: agent },
      server: {
        auth: new MastraAuthBetterAuth({ auth }),
      },
    });

    const expressApp = this.httpAdapterHost.httpAdapter.getInstance();
    const server = new MastraServer({
      app: expressApp,
      mastra,
      prefix: "/mastra",
    });
    await server.init();

    this.logger.log("Mastra agent mounted at /mastra/*");
  }
}
```

Note: The exact `Mastra`, `MastraServer`, and `MastraAuthBetterAuth` constructor signatures may differ from what's shown. After installing the packages (Task 2, Step 3), check the embedded docs and adapt the imports and constructor calls to match the installed version. The structure (create tools → create agent → create Mastra → mount server) stays the same.

- [ ] **Step 6: Import AiModule in `apps/core/src/app.module.ts`**

Current file:

```typescript
import { Module } from "@nestjs/common";
import { DrizzleModule } from "./db";
import { AuthModule } from "./auth/auth.module";
import { HealthModule } from "./health/health.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { UsersModule } from "./users/users.module";
import { GoalsModule } from "./goals/goals.module";
import { TasksModule } from "./tasks/tasks.module";
import { SchedulingModule } from "./scheduling/scheduling.module";

@Module({
  imports: [
    DrizzleModule,
    AuthModule,
    HealthModule,
    RealtimeModule,
    UsersModule,
    GoalsModule,
    TasksModule,
    SchedulingModule,
  ],
})
export class AppModule {}
```

Add the import and include in the imports array:

```typescript
import { AiModule } from "./ai/ai.module";
```

Add `AiModule` to the `imports` array after `SchedulingModule`.

- [ ] **Step 7: Verify the app starts**

```bash
pnpm --filter @consistent/core dev
```

Expected: App starts and logs `Mastra agent mounted at /mastra/*`. Requires `OPENAI_API_KEY` in `.env`.

If it fails, check:
- Import paths for Mastra packages (ESM vs CJS issues)
- Constructor signature mismatches (check embedded docs)
- Missing env vars

- [ ] **Step 8: Test the agent endpoint manually**

```bash
curl -X POST http://localhost:3001/mastra/agents/consistent-agent/generate \
  -H "Content-Type: application/json" \
  -H "Cookie: <paste-session-cookie-from-browser>" \
  -d '{"messages": [{"role": "user", "content": "What are my goals?"}]}'
```

Expected: A JSON response with the agent's reply. If not authenticated, expect a 401.

- [ ] **Step 9: Run all tests**

```bash
pnpm --filter @consistent/core test
```

Expected: All existing tests + new AI tests pass.

- [ ] **Step 10: Commit**

```bash
git add apps/core/src/ai/ai.service.ts apps/core/src/ai/ai.service.spec.ts apps/core/src/ai/ai.module.ts apps/core/src/app.module.ts
git commit -m "feat(ai): create AiModule with Mastra Express mount and wire into AppModule"
```

---

## Task 8: Frontend — install assistant-ui and replace chat panel

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/app/(app)/page.tsx`

- [ ] **Step 1: Install assistant-ui**

```bash
pnpm --filter @consistent/web add @assistant-ui/react
```

- [ ] **Step 2: Check assistant-ui docs for Mastra integration**

assistant-ui has runtime adapters for different backends. Check if there's a Mastra-specific runtime or if the generic fetch-based approach works:

```bash
ls apps/web/node_modules/@assistant-ui/react/dist/ 2>/dev/null | head -20
```

The integration approach depends on what assistant-ui exports. The simplest path is using the `useExternalStoreRuntime` or a Mastra-compatible runtime. Consult `https://www.assistant-ui.com/docs` for the current integration guide with Mastra.

- [ ] **Step 3: Replace `AIChatSection` in `apps/web/src/app/(app)/page.tsx`**

The current `AIChatSection` component (around line ~700-800 in the dashboard page) uses canned responses with static `AI_RESPONSES` array and local state.

Replace it with assistant-ui components connected to the Mastra agent endpoint. The exact implementation depends on the assistant-ui runtime adapter discovered in Step 2. The general pattern:

```typescript
import { AssistantRuntimeProvider, Thread } from "@assistant-ui/react";
// Import the appropriate runtime adapter

function AIChatSection() {
  // Set up the runtime pointing to /mastra/agents/consistent-agent/stream
  // with credentials: "include" for session cookie auth

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  );
}
```

Key requirements:
- Point at `${process.env.NEXT_PUBLIC_API_URL}/mastra/agents/consistent-agent/stream`
- Include `credentials: "include"` so the session cookie is sent
- Streaming response rendering
- Remove the old `AI_RESPONSES` array, `ChatMessage` type, and canned response logic

- [ ] **Step 4: Start dev servers and test in browser**

```bash
# Terminal 1
pnpm --filter @consistent/core dev

# Terminal 2
pnpm --filter @consistent/web dev
```

Open `http://localhost:3000`, sign in, and test the chat panel:
1. Type "What are my goals?" — agent should call `get-goals` tool and respond with real data
2. Type "Create a goal called Learn TypeScript" — agent should call `create-goal`
3. Type "Break down that goal into tasks" — agent should call `bulk-create-tasks`
4. Verify streaming works (tokens appear progressively)
5. Verify errors are handled (try with API key missing)

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): replace canned chat with assistant-ui connected to Mastra agent" -- apps/web/package.json apps/web/src/app/\(app\)/page.tsx pnpm-lock.yaml
```

---

## Task 9: Update CLAUDE.md and final verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**

Replace all references to `apps/api` with `apps/core` and `@consistent/api` with `@consistent/core` throughout the file. Add the AI module to the repository structure, tech stack table, and relevant sections:

**Tech stack table** — add row:

```
| AI Agent | Mastra + Vercel AI SDK | @mastra/core |
```

**Repository structure** — add under `apps/core/src/`:

```
      ai/
        ai.module.ts            # Mastra mount on Express via OnModuleInit
        ai.service.ts           # Programmatic agent access
        agent.ts                # Agent definition (instructions, model)
        tools/                  # 16 tools: goal/task/schedule CRUD
```

**Environment Variables** — add to API table:

```
| AI_MODEL | No | Mastra model string (default: openai/gpt-4o) |
| OPENAI_API_KEY | Conditional | Required when using OpenAI models |
```

**Common Commands** — update `--filter @consistent/api` to `--filter @consistent/core`

**API Endpoints** — add:

```
### AI Agent (Mastra — at /mastra/*)
- POST /mastra/agents/consistent-agent/generate — Single response
- POST /mastra/agents/consistent-agent/stream — Streaming response
```

- [ ] **Step 2: Run full verification**

```bash
# Build everything
pnpm build

# Run all tests
pnpm test

# Typecheck
pnpm typecheck
```

Expected: All pass.

- [ ] **Step 3: Start both apps and test end-to-end**

```bash
pnpm dev
```

Test the complete flow:
1. Sign in at `http://localhost:3000`
2. Open the chat panel
3. Ask "What are my goals?" — verify real data comes back
4. Ask "Create a goal called Ship v1" — verify goal appears in the goals section
5. Ask "Break that goal into 5 tasks" — verify tasks are created
6. Ask "Schedule the first task for tomorrow 9-10am" — verify block appears
7. Ask "Delete that schedule block" — verify it confirms before deleting

- [ ] **Step 4: Commit CLAUDE.md**

```bash
git commit -m "docs: update CLAUDE.md for apps/core rename and AI module" -- CLAUDE.md
```
