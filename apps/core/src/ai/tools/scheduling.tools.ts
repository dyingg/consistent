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
    description:
      "Partial update on a scheduled block. Any subset of { status, startTime, endTime, taskId } is valid — e.g. send only endTime to extend the block. Returns { block, conflicts }; surface any conflicts to the user rather than silently overwriting.",
    inputSchema: z.object({
      blockId: z.number(),
      status: z
        .enum(["planned", "confirmed", "completed", "missed", "moved"])
        .optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
      taskId: z.number().optional(),
    }),
    outputSchema: z.any(),
    execute: async (input, context) =>
      safe(async () => {
        const patch: Parameters<SchedulingService["updateBlock"]>[2] = {};
        if (input.status !== undefined) patch.status = input.status;
        if (input.taskId !== undefined) patch.taskId = input.taskId;
        if (input.startTime !== undefined)
          patch.startTime = new Date(input.startTime);
        if (input.endTime !== undefined)
          patch.endTime = new Date(input.endTime);
        return schedulingService.updateBlock(
          getUserId(context),
          input.blockId,
          patch,
        );
      }),
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
