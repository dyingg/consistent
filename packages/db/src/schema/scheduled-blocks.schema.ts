import {
  bigint,
  bigserial,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { tasks } from "./tasks.schema.js";
import { scheduleRuns } from "./schedule-runs.schema.js";

export const blockStatusEnum = pgEnum("block_status", [
  "planned",
  "confirmed",
  "completed",
  "missed",
  "moved",
]);

export const scheduledByEnum = pgEnum("scheduled_by", [
  "llm",
  "user",
  "recurring",
]);

export const scheduledBlocks = pgTable(
  "scheduled_blocks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    taskId: bigint("task_id", { mode: "number" })
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    status: blockStatusEnum("status").notNull().default("planned"),
    scheduledBy: scheduledByEnum("scheduled_by").notNull().default("llm"),
    scheduleRunId: bigint("schedule_run_id", { mode: "number" }).references(
      () => scheduleRuns.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_scheduled_blocks_user_time").on(
      table.userId,
      table.startTime,
      table.endTime,
    ),
    index("idx_scheduled_blocks_task").on(table.taskId),
  ],
);
