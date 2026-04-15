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

export const goalUpdatedSchema = z.object({
  goalId: z.number(),
});

export const taskUpdatedSchema = z.object({
  taskId: z.number(),
  goalId: z.number(),
});

export const scheduleUpdatedSchema = z.object({
  blockId: z.number().optional(),
});

export type GoalUpdatedEvent = z.infer<typeof goalUpdatedSchema>;
export type TaskUpdatedEvent = z.infer<typeof taskUpdatedSchema>;
export type ScheduleUpdatedEvent = z.infer<typeof scheduleUpdatedSchema>;

export const EVENTS = {
  PING: "ping",
  PONG: "pong",
  GOAL_UPDATED: "goal:updated",
  TASK_UPDATED: "task:updated",
  SCHEDULE_UPDATED: "schedule:updated",
} as const;
