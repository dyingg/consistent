import type { GoalsService } from "../../goals/goals.service";
import type { TasksService } from "../../tasks/tasks.service";
import type { SchedulingService } from "../../scheduling/scheduling.service";
import { createGoalTools } from "./goals.tools";
import { createTaskTools } from "./tasks.tools";
import { createSchedulingTools } from "./scheduling.tools";

export function createTools(
  goalsService: GoalsService,
  tasksService: TasksService,
  schedulingService: SchedulingService,
) {
  return {
    ...createGoalTools(goalsService),
    ...createTaskTools(tasksService),
    ...createSchedulingTools(schedulingService),
  } as Record<string, any>;
}
