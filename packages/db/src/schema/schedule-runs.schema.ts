import {
  bigserial,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";

export const scheduleRuns = pgTable("schedule_runs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  triggeredBy: text("triggered_by"),
  model: text("model"),
  inputSnapshot: jsonb("input_snapshot").$type<Record<string, unknown>>(),
  output: jsonb("output").$type<Record<string, unknown>>(),
  rationale: text("rationale"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
