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
    AI_MODEL: z.string().default("openai/gpt-4o"),
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
  },
  runtimeEnv: process.env,
});
