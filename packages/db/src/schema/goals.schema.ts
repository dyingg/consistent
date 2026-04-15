import {
  bigserial,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";

export const goalStatusEnum = pgEnum("goal_status", [
  "active",
  "completed",
  "paused",
  "abandoned",
]);

export const goals = pgTable(
  "goals",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    descriptionContext: text("description_context"),
    color: text("color"),
    status: goalStatusEnum("status").notNull().default("active"),
    targetDate: date("target_date"),
    priority: smallint("priority").notNull().default(3),
    totalTasks: integer("total_tasks").notNull().default(0),
    completedTasks: integer("completed_tasks").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("idx_goals_user_status").on(table.userId, table.status)],
);
