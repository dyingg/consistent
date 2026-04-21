import { createScorer } from "@mastra/core/evals";
import { extractToolResults } from "@mastra/evals/scorers/utils";

interface TaskCreateArgs {
  title?: string;
  context?: string | null;
}

interface BulkCreateArgs {
  tasks?: TaskCreateArgs[];
}

interface Missing {
  tool: string;
  title: string;
}

interface ContextPreprocessResult {
  missing: Missing[];
  creations: number;
}

function isFilled(s: string | null | undefined): boolean {
  return typeof s === "string" && s.trim().length > 0;
}

export const contextFilledScorer = createScorer({
  id: "context-filled",
  description:
    "Every task the coach creates has a non-empty `context` field, per coach rules.",
  type: "agent",
})
  .preprocess(({ run }): ContextPreprocessResult => {
    const calls = extractToolResults(run.output);
    const missing: Missing[] = [];
    let creations = 0;

    for (const call of calls) {
      if (call.toolName === "create-task") {
        const args = call.args as TaskCreateArgs;
        creations += 1;
        if (!isFilled(args.context)) {
          missing.push({ tool: call.toolName, title: args.title ?? "(untitled)" });
        }
      } else if (call.toolName === "bulk-create-tasks") {
        const args = call.args as BulkCreateArgs;
        for (const t of args.tasks ?? []) {
          creations += 1;
          if (!isFilled(t.context)) {
            missing.push({ tool: call.toolName, title: t.title ?? "(untitled)" });
          }
        }
      }
    }

    return { missing, creations };
  })
  .generateScore(({ results }) => {
    const { missing, creations } = results.preprocessStepResult;
    if (creations === 0) return 1;
    return 1 - missing.length / creations;
  })
  .generateReason(({ results }) => {
    const { missing, creations } = results.preprocessStepResult;
    if (creations === 0) return "No task creations observed.";
    if (missing.length === 0)
      return `All ${creations} creations filled the context field.`;
    return `${missing.length}/${creations} creations omitted context: ${missing.map((m) => m.title).join(", ")}.`;
  });
