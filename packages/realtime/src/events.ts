import { z } from "zod";

export const pingEventSchema = z.object({
  type: z.literal("ping"),
});

export const pongEventSchema = z.object({
  type: z.literal("pong"),
  timestamp: z.string().datetime(),
});

export type PingEvent = z.infer<typeof pingEventSchema>;
export type PongEvent = z.infer<typeof pongEventSchema>;

export const EVENTS = {
  PING: "ping",
  PONG: "pong",
} as const;
