/**
 * Seed dataset: task-breakdown cases.
 *
 * Each case is a single-turn user message that should elicit task creation.
 * Ground truth is encoded in the scorers (Fibonacci points, filled context,
 * bulk-create over repeated create-task), not in this array — each scorer
 * decides pass/fail independently.
 */
export const planningCases: { input: string }[] = [
  {
    input:
      'I have a new goal: "Ship v1 of my side project". Break it down into 4-6 concrete tasks with dependencies.',
  },
  {
    input:
      'For my "Run a 5k" goal (id 1), please add these 3 tasks and wire them up: buy running shoes, do a couch-to-5k week 1, run my first timed mile.',
  },
  {
    input: "Add a task to goal 1: finish the Better Auth migration. It's roughly a day of work.",
  },
];
