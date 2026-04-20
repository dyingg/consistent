/**
 * Standalone eval runner.
 *
 * Usage: pnpm --filter @consistent/core evals
 *
 * Requires a provider API key matching AI_MODEL (set in env). Exits 1 if any
 * scorer falls below its threshold.
 */
import { runEvals } from "@mastra/core/evals";
import type { GoalsService } from "../../goals/goals.service";
import type { TasksService } from "../../tasks/tasks.service";
import type { SchedulingService } from "../../scheduling/scheduling.service";
import type { UsersRepository } from "../../users/users.repository";
import {
  bulkPreferredScorer,
  contextFilledScorer,
  createEvalAgent,
  fibonacciPointsScorer,
  planningCases,
} from "./index";

const MODEL = process.env.AI_MODEL ?? "anthropic/claude-haiku-4-5";

const THRESHOLDS: Record<string, number> = {
  "fibonacci-points": 0.9,
  "context-filled": 0.8,
  "bulk-preferred": 0.9,
};

function stubGoals(): GoalsService {
  return {
    findAll: async () => [
      { id: 1, title: "Run a 5k", status: "active", progress: 0 },
    ],
    create: async (_userId: string, input: { title: string }) => ({
      id: 42,
      ...input,
      status: "active",
    }),
    update: async () => ({ id: 1 }),
    delete: async () => undefined,
  } as unknown as GoalsService;
}

function stubTasks(): TasksService {
  return {
    findAllForGoal: async () => [],
    findReadyForUser: async () => [],
    getGoalDag: async () => ({ tasks: [], edges: [] }),
    create: async (_userId: string, goalId: number, input: { title: string }) => ({
      id: Math.floor(Math.random() * 10_000),
      goalId,
      ...input,
      status: "pending",
    }),
    bulkCreate: async () => ({ tasks: [], edges: [] }),
    update: async () => ({ id: 1 }),
    delete: async () => undefined,
  } as unknown as TasksService;
}

function stubScheduling(): SchedulingService {
  return {
    getBlocksForRange: async () => [],
    getCurrentBlock: async () => null,
    createBlock: async () => ({ block: { id: 1 }, conflicts: [] }),
    updateBlock: async () => ({ block: { id: 1 }, conflicts: [] }),
    shiftBlocks: async () => ({ blocks: [], conflicts: [] }),
    deleteBlock: async () => undefined,
  } as unknown as SchedulingService;
}

function stubUsers(): UsersRepository {
  return {
    findById: async () => ({ id: "test-user", timezone: "UTC" }),
    updateTimezone: async () => undefined,
  } as unknown as UsersRepository;
}

async function main(): Promise<void> {
  const agent = createEvalAgent(
    {
      goals: stubGoals(),
      tasks: stubTasks(),
      scheduling: stubScheduling(),
      users: stubUsers(),
    },
    MODEL,
  );

  console.log(`\n▶ Running coach evals (model: ${MODEL})`);
  console.log(`  cases: ${planningCases.length}\n`);

  const result = await runEvals({
    target: agent,
    data: planningCases,
    scorers: [fibonacciPointsScorer, contextFilledScorer, bulkPreferredScorer],
    concurrency: 1,
    onItemComplete: ({ item, scorerResults }) => {
      const line = typeof item.input === "string" ? item.input : "<complex>";
      const scores: Record<string, number | undefined> = {};
      for (const [name, data] of Object.entries(scorerResults)) {
        scores[name] = (data as { score?: number })?.score;
      }
      console.log(`  ✓ ${line.slice(0, 80)}${line.length > 80 ? "…" : ""}`);
      console.log(`    ${JSON.stringify(scores)}`);
    },
  });

  console.log("\n── Aggregate scores ─────────────────────────────");
  for (const [name, score] of Object.entries(result.scores)) {
    const threshold = THRESHOLDS[name];
    const pass = typeof threshold === "number" ? score >= threshold : true;
    const marker = pass ? "✓" : "✗";
    const target = typeof threshold === "number" ? ` (≥ ${threshold})` : "";
    console.log(`  ${marker} ${name}: ${score.toFixed(3)}${target}`);
  }

  const failed = Object.entries(result.scores).filter(([name, score]) => {
    const t = THRESHOLDS[name];
    return typeof t === "number" && score < t;
  });

  if (failed.length > 0) {
    console.error(
      `\n✗ ${failed.length} scorer(s) below threshold: ${failed.map(([n]) => n).join(", ")}`,
    );
    process.exit(1);
  }

  console.log(`\n✓ All scorers passed across ${result.summary.totalItems} cases`);
}

main().catch((err) => {
  console.error("Eval run failed:", err);
  process.exit(1);
});
