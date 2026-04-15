import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
} from "drizzle-orm/pg-core";
import { tasks } from "./tasks.schema.js";

export const dependencyTypeEnum = pgEnum("dependency_type", [
  "finish_to_start",
  "start_to_start",
  "finish_to_finish",
  "start_to_finish",
]);

/**
 * DAG edges for task dependencies.
 *
 * Convention: a row `(taskId=A, dependsOnId=B)` means "A depends on B" —
 * B must finish before A can start (for finish_to_start type).
 *
 * The `prevent_cycle` database trigger enforces acyclicity via recursive CTE.
 * The `chk_no_self_dep` check constraint prevents self-references.
 */
export const taskDependencies = pgTable(
  "task_dependencies",
  {
    taskId: bigint("task_id", { mode: "number" })
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnId: bigint("depends_on_id", { mode: "number" })
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependencyType: dependencyTypeEnum("dependency_type")
      .notNull()
      .default("finish_to_start"),
    lagMinutes: integer("lag_minutes").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.dependsOnId] }),
    index("idx_task_deps_depends_on").on(table.dependsOnId),
  ],
);
