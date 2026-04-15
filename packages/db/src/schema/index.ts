// Auth tables (Better Auth)
export { user, session, account, verification } from "./auth.js";
export type { UserPreferences } from "./auth.js";

// Domain tables
export { goals, goalStatusEnum } from "./goals.schema.js";
export { tasks, taskStatusEnum } from "./tasks.schema.js";
export {
  taskDependencies,
  dependencyTypeEnum,
} from "./task-dependencies.schema.js";
export { scheduleRuns } from "./schedule-runs.schema.js";
export {
  scheduledBlocks,
  blockStatusEnum,
  scheduledByEnum,
} from "./scheduled-blocks.schema.js";

// Zod schemas
export * from "./zod.js";
