import { initContract } from "@ts-rest/core";
import { z } from "zod";

const c = initContract();

const enrichedBlockSchema = z.object({
  id: z.number(),
  taskId: z.number(),
  startTime: z.string(),
  endTime: z.string(),
  status: z.enum(["planned", "confirmed", "completed", "missed", "moved"]),
  scheduledBy: z.enum(["llm", "user", "recurring"]),
  createdAt: z.string(),
  task: z.object({
    id: z.number(),
    title: z.string(),
    description: z.string().nullable(),
    status: z.enum([
      "pending",
      "ready",
      "scheduled",
      "in_progress",
      "completed",
      "blocked",
      "cancelled",
    ]),
    goalId: z.number(),
  }),
  goal: z.object({
    id: z.number(),
    title: z.string(),
    color: z.string().nullable(),
  }),
});

export const scheduleContract = c.router({
  blocks: {
    method: "GET",
    path: "/v1/schedule/blocks",
    query: z.object({
      start: z.string(),
      end: z.string(),
    }),
    responses: {
      200: z.array(enrichedBlockSchema),
    },
    summary: "Get scheduled blocks for a date range",
  },
  now: {
    method: "GET",
    path: "/v1/schedule/now",
    responses: {
      200: enrichedBlockSchema.nullable(),
    },
    summary: "Get the currently active scheduled block",
  },
});
