import { Agent } from "@mastra/core/agent";
import type { GoalsService } from "../../goals/goals.service";
import type { TasksService } from "../../tasks/tasks.service";
import type { SchedulingService } from "../../scheduling/scheduling.service";
import type { UsersRepository } from "../../users/users.repository";
import { COACH_SYSTEM_PROMPT } from "../prompts/coach";
import { createTools } from "../tools";

export interface EvalAgentServices {
  goals: GoalsService;
  tasks: TasksService;
  scheduling: SchedulingService;
  users: UsersRepository;
}

/**
 * Agent used only for eval runs. Same prompt, model, and tools as the
 * production coach — but no Memory, and callers supply their own services
 * (real or mocked). Production code still goes through `createCoachAgent`.
 */
export function createEvalAgent(
  services: EvalAgentServices,
  model: string,
): Agent {
  return new Agent({
    id: "consistent-coach-eval",
    name: "Consistent Coach (eval)",
    instructions: COACH_SYSTEM_PROMPT,
    model,
    tools: createTools(
      services.goals,
      services.tasks,
      services.scheduling,
      services.users,
    ),
  });
}
