import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { SchedulingService } from "../../scheduling/scheduling.service";
import { getUserId, safe } from "./context";

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
    description:
      "Schedule a time block for a task. Returns { block, conflicts }; if conflicts is non-empty, surface them before moving on.",
    inputSchema: z.object({
      taskId: z.number(),
      startTime: z.string(),
      endTime: z.string(),
    }),
    outputSchema: z.any(),
    execute: async (input, context) =>
      safe(async () =>
        schedulingService.createBlock(getUserId(context), {
          taskId: input.taskId,
          startTime: new Date(input.startTime),
          endTime: new Date(input.endTime),
          scheduledBy: "llm",
        }),
      ),
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

  const shiftBlocks = createTool({
    id: "shift-blocks",
    description:
      "Shift one or more blocks forward or backward in time by deltaMinutes (may be negative). Use blockIds when you already know which blocks to move (e.g. the ones you just listed to the user). Use afterTime when the user's day was disrupted and everything from a point onward should slide — this saves a get-schedule call. Exactly one selector must be provided. Runs in one transaction; ownership is enforced server-side. Returns { blocks, conflicts } — surface conflicts to the user before assuming the shift is final.",
    inputSchema: z
      .object({
        deltaMinutes: z
          .number()
          .int()
          .describe(
            "Positive shifts later, negative shifts earlier. Must be non-zero.",
          ),
        blockIds: z.array(z.number()).optional(),
        afterTime: z
          .string()
          .optional()
          .describe(
            "ISO 8601. Shifts every block whose startTime >= this instant.",
          ),
      })
      .refine((v) => (v.blockIds ? !v.afterTime : !!v.afterTime), {
        message: "Provide exactly one of blockIds or afterTime",
      }),
    outputSchema: z.any(),
    execute: async (input, context) =>
      safe(async () => {
        if (input.blockIds) {
          return schedulingService.shiftBlocks(getUserId(context), {
            blockIds: input.blockIds,
            deltaMinutes: input.deltaMinutes,
          });
        }
        return schedulingService.shiftBlocks(getUserId(context), {
          afterTime: new Date(input.afterTime!),
          deltaMinutes: input.deltaMinutes,
        });
      }),
  });

  const deleteBlock = createTool({
    id: "delete-block",
    description: "Permanently delete a scheduled block.",
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
    "shift-blocks": shiftBlocks,
    "delete-block": deleteBlock,
  };
}
