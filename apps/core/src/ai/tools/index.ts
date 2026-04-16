import type { GoalsService } from "../../goals/goals.service";
import type { TasksService } from "../../tasks/tasks.service";
import type { SchedulingService } from "../../scheduling/scheduling.service";
import { createGoalTools } from "./goals.tools";

export function createTools(
  goalsService: GoalsService,
  tasksService: TasksService,
  schedulingService: SchedulingService,
) {
  return {
    ...createGoalTools(goalsService),
  } as Record<string, any>;
}
