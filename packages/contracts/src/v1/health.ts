import { initContract } from "@ts-rest/core";
import { z } from "zod";

const c = initContract();

export const healthContract = c.router({
  check: {
    method: "GET",
    path: "/v1/health",
    responses: {
      200: z.object({
        status: z.enum(["ok", "degraded"]),
        db: z.enum(["ok", "error"]),
        redis: z.enum(["ok", "error"]),
      }),
    },
    summary: "Health check",
  },
  version: {
    method: "GET",
    path: "/v1/version",
    responses: {
      200: z.object({
        version: z.string(),
      }),
    },
    summary: "API version",
  },
});
