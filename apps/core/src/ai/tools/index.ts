import type { GoalsService } from "../../goals/goals.service";
import type { TasksService } from "../../tasks/tasks.service";
import type { SchedulingService } from "../../scheduling/scheduling.service";
import type { UsersRepository } from "../../users/users.repository";
import { createGoalTools } from "./goals.tools";
import { createTaskTools } from "./tasks.tools";
import { createSchedulingTools } from "./scheduling.tools";
import { createTimeTools } from "./time.tools";

export function createTools(
  goalsService: GoalsService,
  tasksService: TasksService,
  schedulingService: SchedulingService,
  usersRepository: UsersRepository,
) {
  // Returning the inferred shape (vs. casting to Record<string, unknown>)
  // keeps each tool's `execute` callable for tests and the agent factory.
  return {
    ...createGoalTools(goalsService),
    ...createTaskTools(tasksService, goalsService),
    ...createSchedulingTools(schedulingService),
    ...createTimeTools(usersRepository),
  };
}
