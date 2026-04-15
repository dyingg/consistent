import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { user } from "./auth.js";
import { goals } from "./goals.schema.js";
import { tasks } from "./tasks.schema.js";
import { taskDependencies } from "./task-dependencies.schema.js";
import { scheduleRuns } from "./schedule-runs.schema.js";
import { scheduledBlocks } from "./scheduled-blocks.schema.js";

// User
export const insertUserSchema = createInsertSchema(user);
export const selectUserSchema = createSelectSchema(user);

// Goals
export const insertGoalSchema = createInsertSchema(goals);
export const selectGoalSchema = createSelectSchema(goals);

// Tasks
export const insertTaskSchema = createInsertSchema(tasks);
export const selectTaskSchema = createSelectSchema(tasks);

// Task Dependencies
export const insertTaskDependencySchema = createInsertSchema(taskDependencies);
export const selectTaskDependencySchema = createSelectSchema(taskDependencies);

// Schedule Runs
export const insertScheduleRunSchema = createInsertSchema(scheduleRuns);
export const selectScheduleRunSchema = createSelectSchema(scheduleRuns);

// Scheduled Blocks
export const insertScheduledBlockSchema = createInsertSchema(scheduledBlocks);
export const selectScheduledBlockSchema = createSelectSchema(scheduledBlocks);
