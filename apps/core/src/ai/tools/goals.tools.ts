import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { GoalsService } from "../../goals/goals.service";

const RESOURCE_ID_KEY = "mastra__resourceId";

export function createGoalTools(goalsService: GoalsService) {
  const getGoals = createTool({
    id: "get-goals",
    description:
      "Get all goals for the current user with progress percentages. Use this to understand what the user is working toward.",
    inputSchema: z.object({
      status: z
        .enum(["active", "completed", "paused", "abandoned"])
        .optional()
        .describe("Filter by status. Omit to get all goals."),
    }),
    outputSchema: z.object({ goals: z.array(z.any()) }),
    execute: async (input, context) => {
      const userId = context?.requestContext?.get(RESOURCE_ID_KEY) as string;
      const goals = await goalsService.findAll(userId, input.status);
      return { goals };
    },
  });

  const createGoal = createTool({
    id: "create-goal",
    description:
      "Create a new goal for the user. Ask the user for a title before calling this.",
    inputSchema: z.object({
      title: z.string().describe("The goal title"),
      description: z
        .string()
        .nullable()
        .optional()
        .describe("Longer description of the goal"),
      context: z.string().nullable().optional().describe("Additional context"),
      color: z
        .string()
        .nullable()
        .optional()
        .describe("Hex color code for UI display"),
      targetDate: z
        .string()
        .nullable()
        .optional()
        .describe("Target completion date (ISO 8601)"),
      priority: z
        .number()
        .optional()
        .describe("Priority 1-5, lower is higher priority"),
    }),
    outputSchema: z.object({ goal: z.any() }),
    execute: async (input, context) => {
      const userId = context?.requestContext?.get(RESOURCE_ID_KEY) as string;
      const goal = await goalsService.create(userId, input);
      return { goal };
    },
  });

  const updateGoal = createTool({
    id: "update-goal",
    description:
      "Update an existing goal's title, description, status, or other fields.",
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
      const userId = context?.requestContext?.get(RESOURCE_ID_KEY) as string;
      const { goalId, ...data } = input;
      const goal = await goalsService.update(userId, goalId, data);
      return { goal };
    },
  });

  const deleteGoal = createTool({
    id: "delete-goal",
    description:
      "Permanently delete a goal and all its tasks. Cascades to every task under the goal — use judgment when the target is ambiguous. The Inbox goal (isInbox=true) cannot be deleted and will return an error if attempted.",
    inputSchema: z.object({
      goalId: z.number().describe("The goal ID to delete"),
    }),
    outputSchema: z.object({ success: z.boolean() }),
    execute: async (input, context) => {
      const userId = context?.requestContext?.get(RESOURCE_ID_KEY) as string;
      await goalsService.delete(userId, input.goalId);
      return { success: true };
    },
  });

  return {
    "get-goals": getGoals,
    "create-goal": createGoal,
    "update-goal": updateGoal,
    "delete-goal": deleteGoal,
  };
}
