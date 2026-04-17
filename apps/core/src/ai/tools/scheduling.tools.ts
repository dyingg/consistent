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

async function safe<T>(
  fn: () => Promise<T>,
): Promise<T | { error: true; message: string }> {
  try {
    return await fn();
  } catch (err) {
    return {
      error: true,
      message: err instanceof Error ? err.message : "internal_error",
    };
  }
}

export function createSchedulingTools(schedulingService: SchedulingService) {
  const getSchedule = createTool({
    id: "get-schedule",
    description:
      "Get scheduled blocks in a date range (inclusive start, exclusive end).",
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
