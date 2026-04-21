import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { GoalsService } from "../../goals/goals.service";
import type { TasksService } from "../../tasks/tasks.service";
import { getUserId, safe } from "./context";

function toDate(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return new Date(v);
}

const taskFields = z.object({
  title: z.string(),
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
    .refine((n) => [1, 2, 3, 5, 8, 13].includes(n), {
      message: "sprintPoints must be a Fibonacci value (1, 2, 3, 5, 8, 13)",
    })
    .nullable()
    .optional(),
  priority: z.number().int().min(1).max(5).optional(),
  earliestStart: z.string().nullable().optional(),
  deadline: z.string().nullable().optional(),
  contextTags: z.array(z.string()).nullable().optional(),
});

function normalizeDates<
  T extends { earliestStart?: string | null; deadline?: string | null },
>(patch: T): Omit<T, "earliestStart" | "deadline"> & {
  earliestStart?: Date | null;
  deadline?: Date | null;
} {
  const out: Record<string, unknown> = { ...patch };
  if ("earliestStart" in patch)
    out.earliestStart = toDate(patch.earliestStart);
  if ("deadline" in patch) out.deadline = toDate(patch.deadline);
  return out as Omit<T, "earliestStart" | "deadline"> & {
    earliestStart?: Date | null;
    deadline?: Date | null;
  };
}

const dependencyInput = z.object({
  fromIndex: z.number().int().min(0),
  toIndex: z.number().int().min(0),
  type: z
    .enum([
      "finish_to_start",
      "start_to_start",
      "finish_to_finish",
      "start_to_finish",
    ])
    .optional(),
  lagMinutes: z.number().int().optional(),
});

export function createTaskTools(
  tasksService: TasksService,
  goalsService: GoalsService,
) {
  async function resolveGoalId(
    userId: string,
    goalId: number | undefined,
  ): Promise<number> {
    return goalId ?? (await goalsService.findInboxId(userId));
  }

  const getTasks = createTool({
    id: "get-tasks",
    description: "List tasks for a goal.",
    inputSchema: z.object({ goalId: z.number() }),
    outputSchema: z.any(),
    execute: async (input, context) =>
      safe(async () => ({
        tasks: await tasksService.findAllForGoal(
          getUserId(context),
          input.goalId,
        ),
      })),
  });

  const getReadyTasks = createTool({
    id: "get-ready-tasks",
    description:
      "List tasks with no unresolved blockers that are ready to work on now.",
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
      "Create a single task. Prefer bulk-create-tasks when adding multiple at once. Omit goalId to place the task in the user's Inbox (use for genuine one-offs not tied to a larger objective).",
    inputSchema: taskFields.extend({
      goalId: z
        .number()
        .optional()
        .describe(
          "The goal this task belongs to. Omit for one-off tasks — they will land in the user's Inbox.",
        ),
    }),
    outputSchema: z.any(),
    execute: async (input, context) =>
      safe(async () => {
        const { goalId, ...rest } = input;
        const userId = getUserId(context);
        return {
          task: await tasksService.create(
            userId,
            await resolveGoalId(userId, goalId),
            normalizeDates(rest),
          ),
        };
      }),
  });

  const bulkCreateTasks = createTool({
    id: "bulk-create-tasks",
    description:
      "Create multiple tasks in a single transaction, with optional dependency edges referencing tasks by their index. Omit goalId to place the batch in the user's Inbox (use when the batch is a set of one-offs, not a goal breakdown).",
    inputSchema: z.object({
      goalId: z
        .number()
        .optional()
        .describe(
          "The goal this batch belongs to. Omit for one-off batches — they will land in the user's Inbox.",
        ),
      tasks: z.array(taskFields),
      dependencies: z.array(dependencyInput).optional(),
    }),
    outputSchema: z.any(),
    execute: async (input, context) =>
      safe(async () => {
        const userId = getUserId(context);
        return tasksService.bulkCreate(
          userId,
          await resolveGoalId(userId, input.goalId),
          {
            tasks: input.tasks.map((t) => normalizeDates(t)),
            dependencies: input.dependencies,
          },
        );
      }),
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
      actualMinutes: z.number().int().nonnegative().nullable().optional(),
      sprintPoints: z
        .number()
        .int()
        .refine((n) => [1, 2, 3, 5, 8, 13].includes(n), {
          message: "sprintPoints must be a Fibonacci value (1, 2, 3, 5, 8, 13)",
        })
        .nullable()
        .optional(),
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
          task: await tasksService.update(
            getUserId(context),
            taskId,
            normalizeDates(patch),
          ),
        };
      }),
  });

  const deleteTask = createTool({
    id: "delete-task",
    description:
      "Permanently delete one or more tasks in a single call. All-or-nothing: if any id is missing or not owned by the user, nothing is deleted.",
    inputSchema: z.object({
      taskIds: z.array(z.number()).min(1),
    }),
    outputSchema: z.any(),
    execute: async (input, context) =>
      safe(async () =>
        tasksService.bulkDelete(getUserId(context), input.taskIds),
      ),
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
