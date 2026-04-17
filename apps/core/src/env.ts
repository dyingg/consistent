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
    AI_MODEL: z.string().default("openai/gpt-5.4"),
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    LANGSMITH_TRACING: z
      .union([z.literal("true"), z.literal("false")])
      .optional(),
    LANGSMITH_ENDPOINT: z.string().url().optional(),
    LANGSMITH_API_KEY: z.string().optional(),
    LANGSMITH_PROJECT: z.string().optional(),
  },
  runtimeEnv: process.env,
  createFinalSchema: (shape, isServer) => {
    const base = z.object(shape);
    if (!isServer) return base;
    return base.superRefine((data, ctx) => {
      if (data.AI_MODEL.startsWith("openai/") && !data.OPENAI_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "OPENAI_API_KEY is required when AI_MODEL uses the openai provider",
          path: ["OPENAI_API_KEY"],
        });
      }
      if (data.AI_MODEL.startsWith("anthropic/") && !data.ANTHROPIC_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "ANTHROPIC_API_KEY is required when AI_MODEL uses the anthropic provider",
          path: ["ANTHROPIC_API_KEY"],
        });
      }
    });
  },
});
