import {
  bigint,
  bigserial,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { goals } from "./goals.schema.js";

export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "ready",
  "scheduled",
  "in_progress",
  "completed",
  "blocked",
  "cancelled",
]);

export const tasks = pgTable(
  "tasks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    goalId: bigint("goal_id", { mode: "number" })
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    descriptionContext: text("description_context"),
    status: taskStatusEnum("status").notNull().default("pending"),
    estimatedMinutes: integer("estimated_minutes"),
    actualMinutes: integer("actual_minutes"),
    earliestStart: timestamp("earliest_start", { withTimezone: true }),
    deadline: timestamp("deadline", { withTimezone: true }),
    priority: smallint("priority").notNull().default(3),
    sprintPoints: smallint("sprint_points"),
    contextTags: text("context_tags").array(),
    blockerCount: integer("blocker_count").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_tasks_goal").on(table.goalId),
    index("idx_tasks_user_status").on(table.userId, table.status),
    index("idx_tasks_deadline").on(table.deadline),
  ],
);
