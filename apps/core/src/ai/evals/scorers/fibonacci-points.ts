import { createScorer } from "@mastra/core/evals";
import { extractToolResults } from "@mastra/evals/scorers/utils";

const FIB = new Set([1, 2, 3, 5, 8, 13]);

interface TaskCreateArgs {
  sprintPoints?: number | null;
}

interface BulkCreateArgs {
  tasks?: TaskCreateArgs[];
}

interface Violation {
  tool: string;
  value: number;
}

interface FibPreprocessResult {
  violations: Violation[];
  creations: number;
}

export const fibonacciPointsScorer = createScorer({
  id: "fibonacci-points",
  description:
    "Every task the coach creates uses sprintPoints in {1,2,3,5,8,13}.",
  type: "agent",
})
  .preprocess(({ run }): FibPreprocessResult => {
    const calls = extractToolResults(run.output);
    const violations: Violation[] = [];
    let creations = 0;

    for (const call of calls) {
      if (call.toolName === "create-task") {
        const args = call.args as TaskCreateArgs;
        creations += 1;
        if (
          typeof args.sprintPoints === "number" &&
          !FIB.has(args.sprintPoints)
        ) {
          violations.push({ tool: call.toolName, value: args.sprintPoints });
        }
      } else if (call.toolName === "bulk-create-tasks") {
        const args = call.args as BulkCreateArgs;
        for (const t of args.tasks ?? []) {
          creations += 1;
          if (typeof t.sprintPoints === "number" && !FIB.has(t.sprintPoints)) {
            violations.push({ tool: call.toolName, value: t.sprintPoints });
          }
        }
      }
    }

    return { violations, creations };
  })
  .generateScore(({ results }) => {
    const { violations, creations } = results.preprocessStepResult;
    if (creations === 0) return 1;
    return violations.length === 0 ? 1 : 0;
  })
  .generateReason(({ results }) => {
    const { violations, creations } = results.preprocessStepResult;
    if (creations === 0) return "No task creations observed.";
    if (violations.length === 0)
      return `All ${creations} task creations used Fibonacci sprintPoints.`;
    const bad = violations.map((v) => v.value).join(", ");
    return `${violations.length}/${creations} creations used non-Fibonacci sprintPoints: ${bad}.`;
  });
