import { initContract } from "@ts-rest/core";
import { z } from "zod";

const c = initContract();

export const goalsContract = c.router({
  list: {
    method: "GET",
    path: "/v1/goals",
    query: z.object({
      status: z
        .enum(["active", "completed", "paused", "abandoned"])
        .optional(),
    }),
    responses: {
      200: z.array(
        z.object({
          id: z.number(),
          title: z.string(),
          description: z.string().nullable(),
          color: z.string().nullable(),
          status: z.enum(["active", "completed", "paused", "abandoned"]),
          totalTasks: z.number(),
          completedTasks: z.number(),
          progress: z.number(),
          targetDate: z.string().nullable(),
          priority: z.number(),
          createdAt: z.string(),
          completedAt: z.string().nullable(),
        }),
      ),
    },
    summary: "List goals for authenticated user",
  },
});
