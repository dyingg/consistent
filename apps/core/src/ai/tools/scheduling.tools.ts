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

  const createBlocks = createTool({
    id: "create-blocks",
    description:
      "Schedule one or more time blocks in a single call. Pass an array with one entry for a single block or many entries to schedule several tasks at once — prefer this over looping create calls. All-or-nothing: if ANY block collides with an existing block or with another block in the same call, NOTHING is created and the response is { blocks: [], conflicts: [...] }. Each conflict has inputIndex (which new block is blocked), kind ('existing' or 'cohort'), and the colliding block's task/time. On conflict, tell the user exactly what collides and ask how to adjust, then retry the whole call with revised times.",
    inputSchema: z.object({
      blocks: z
        .array(
          z.object({
            taskId: z.number(),
            startTime: z.string(),
            endTime: z.string(),
          }),
        )
        .min(1),
    }),
    outputSchema: z.any(),
    execute: async (input, context) =>
      safe(async () =>
        schedulingService.bulkCreateBlocks(
          getUserId(context),
          input.blocks.map((b) => ({
            taskId: b.taskId,
            startTime: new Date(b.startTime),
            endTime: new Date(b.endTime),
            scheduledBy: "llm",
          })),
        ),
      ),
  });

  const updateBlock = createTool({
    id: "update-block",
    description:
      "Partial update on a scheduled block. Any subset of { status, startTime, endTime, taskId } is valid — e.g. send only endTime to extend the block. If the new time overlaps another block, the update is rejected and no schedule change is saved; explain the conflict and retry with a different time.",
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
      "Shift one or more blocks forward or backward in time by deltaMinutes (may be negative). Use blockIds when you already know which blocks to move (e.g. the ones you just listed to the user). Use afterTime when the user's day was disrupted and everything from a point onward should slide — this saves a get-schedule call. Exactly one selector must be provided. If any shifted block would overlap an unshifted block, the shift is rejected and no schedule change is saved; explain the conflict and retry with a different move.",
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
    "create-blocks": createBlocks,
    "update-block": updateBlock,
    "shift-blocks": shiftBlocks,
    "delete-block": deleteBlock,
  };
}
