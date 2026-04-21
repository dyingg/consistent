import { createScorer } from "@mastra/core/evals";
import { extractToolResults } from "@mastra/evals/scorers/utils";

interface TaskCreateArgs {
  goalId?: number;
}

interface BulkCreatePreprocessResult {
  singleCountsByGoal: Record<string, number>;
  bulkUsed: boolean;
  violations: string[];
}

export const bulkPreferredScorer = createScorer({
  id: "bulk-preferred",
  description:
    "When adding >=2 tasks to the same goal in one turn, the coach uses bulk-create-tasks instead of repeated create-task.",
  type: "agent",
})
  .preprocess(({ run }): BulkCreatePreprocessResult => {
    const calls = extractToolResults(run.output);
    const singleCountsByGoal: Record<string, number> = {};
    let bulkUsed = false;

    for (const call of calls) {
      if (call.toolName === "bulk-create-tasks") {
        bulkUsed = true;
        continue;
      }
      if (call.toolName === "create-task") {
        const args = call.args as TaskCreateArgs;
        const key = String(args.goalId ?? "unknown");
        singleCountsByGoal[key] = (singleCountsByGoal[key] ?? 0) + 1;
      }
    }

    const violations: string[] = [];
    for (const [goalId, count] of Object.entries(singleCountsByGoal)) {
      if (count >= 2) violations.push(`goal ${goalId}: ${count} create-task calls`);
    }

    return { singleCountsByGoal, bulkUsed, violations };
  })
  .generateScore(({ results }) => {
    const { violations } = results.preprocessStepResult;
    return violations.length === 0 ? 1 : 0;
  })
  .generateReason(({ results }) => {
    const { violations, bulkUsed } = results.preprocessStepResult;
    if (violations.length === 0) {
      return bulkUsed
        ? "bulk-create-tasks was used appropriately."
        : "No bulk-creation patterns detected.";
    }
    return `Detected repeated create-task calls that should have been bulk-create-tasks: ${violations.join("; ")}.`;
  });
