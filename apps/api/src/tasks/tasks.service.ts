import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { tasks, taskDependencies } from "@consistent/db/schema";
import { TasksRepository } from "./tasks.repository";
import { DependenciesRepository } from "./dependencies.repository";
import { GoalsRepository } from "../goals/goals.repository";
import { DRIZZLE, type DrizzleDB } from "../db";

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  descriptionContext?: string | null;
  estimatedMinutes?: number | null;
  earliestStart?: Date | null;
  deadline?: Date | null;
  priority?: number;
  sprintPoints?: number | null;
  contextTags?: string[] | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  descriptionContext?: string | null;
  status?:
    | "pending"
    | "ready"
    | "scheduled"
    | "in_progress"
    | "completed"
    | "blocked"
    | "cancelled";
  estimatedMinutes?: number | null;
  actualMinutes?: number | null;
  earliestStart?: Date | null;
  deadline?: Date | null;
  priority?: number;
  sprintPoints?: number | null;
  contextTags?: string[] | null;
}

export interface BulkCreateInput {
  tasks: CreateTaskInput[];
  dependencies?: {
    fromIndex: number;
    toIndex: number;
    type?:
      | "finish_to_start"
      | "start_to_start"
      | "finish_to_finish"
      | "start_to_finish";
    lagMinutes?: number;
  }[];
}

@Injectable()
export class TasksService {
  constructor(
    private readonly tasksRepo: TasksRepository,
    private readonly depsRepo: DependenciesRepository,
    private readonly goalsRepo: GoalsRepository,
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
  ) {}

  private async verifyGoalOwnership(userId: string, goalId: number) {
    const goal = await this.goalsRepo.findById(goalId);
    if (!goal || goal.userId !== userId) {
      throw new NotFoundException("Goal not found");
    }
    return goal;
  }

  private async verifyTaskOwnership(userId: string, taskId: number) {
    const task = await this.tasksRepo.findById(taskId);
    if (!task || task.userId !== userId) {
      throw new NotFoundException("Task not found");
    }
    return task;
  }

  async create(userId: string, goalId: number, data: CreateTaskInput) {
    await this.verifyGoalOwnership(userId, goalId);

    const title = data.title?.trim();
    if (!title) {
      throw new BadRequestException("Title is required");
    }

    return this.tasksRepo.create({ ...data, title, userId, goalId });
  }

  async bulkCreate(userId: string, goalId: number, input: BulkCreateInput) {
    await this.verifyGoalOwnership(userId, goalId);

    if (!input.tasks.length) {
      throw new BadRequestException("At least one task is required");
    }

    for (const t of input.tasks) {
      if (!t.title?.trim()) {
        throw new BadRequestException("All tasks must have a title");
      }
    }

    if (input.dependencies) {
      for (const dep of input.dependencies) {
        if (dep.fromIndex < 0 || dep.fromIndex >= input.tasks.length) {
          throw new BadRequestException(
            `Invalid fromIndex: ${dep.fromIndex}`,
          );
        }
        if (dep.toIndex < 0 || dep.toIndex >= input.tasks.length) {
          throw new BadRequestException(`Invalid toIndex: ${dep.toIndex}`);
        }
        if (dep.fromIndex === dep.toIndex) {
          throw new BadRequestException(
            "A task cannot depend on itself",
          );
        }
      }
    }

    return this.db.transaction(async (tx) => {
      const taskRows = input.tasks.map((t) => ({
        goalId,
        userId,
        title: t.title.trim(),
        description: t.description,
        descriptionContext: t.descriptionContext,
        estimatedMinutes: t.estimatedMinutes,
        earliestStart: t.earliestStart,
        deadline: t.deadline,
        priority: t.priority,
        sprintPoints: t.sprintPoints,
        contextTags: t.contextTags,
      }));

      const insertedTasks = await tx
        .insert(tasks)
        .values(taskRows)
        .returning();

      let insertedDeps: (typeof taskDependencies.$inferSelect)[] = [];

      if (input.dependencies?.length) {
        const depRows = input.dependencies.map((d) => ({
          taskId: insertedTasks[d.fromIndex]!.id,
          dependsOnId: insertedTasks[d.toIndex]!.id,
          dependencyType:
            d.type ?? ("finish_to_start" as const),
          lagMinutes: d.lagMinutes ?? 0,
        }));

        try {
          insertedDeps = await tx
            .insert(taskDependencies)
            .values(depRows)
            .returning();
        } catch (error: unknown) {
          const pgError = error as { code?: string; message?: string };
          if (
            pgError.code === "23514" ||
            pgError.message?.includes("cycle detected")
          ) {
            throw new BadRequestException(
              "Dependency edges would create a circular dependency",
            );
          }
          throw error;
        }
      }

      return { tasks: insertedTasks, dependencies: insertedDeps };
    });
  }

  async findAllForGoal(userId: string, goalId: number) {
    await this.verifyGoalOwnership(userId, goalId);
    return this.tasksRepo.findByGoalId(goalId);
  }

  async findById(userId: string, taskId: number) {
    return this.verifyTaskOwnership(userId, taskId);
  }

  async update(userId: string, taskId: number, data: UpdateTaskInput) {
    await this.verifyTaskOwnership(userId, taskId);

    if (data.title !== undefined) {
      const title = data.title.trim();
      if (!title) {
        throw new BadRequestException("Title is required");
      }
      data.title = title;
    }

    const updateData: Record<string, unknown> = { ...data };

    if (data.status === "completed") {
      updateData.completedAt = new Date();
    } else if (data.status && data.status !== "completed") {
      updateData.completedAt = null;
    }

    return this.tasksRepo.update(taskId, updateData as any);
  }

  async delete(userId: string, taskId: number) {
    await this.verifyTaskOwnership(userId, taskId);
    return this.tasksRepo.delete(taskId);
  }

  async findReadyForUser(userId: string) {
    return this.tasksRepo.findReadyForUser(userId);
  }

  async getGoalDag(userId: string, goalId: number) {
    await this.verifyGoalOwnership(userId, goalId);
    return this.tasksRepo.getGoalDag(goalId);
  }

  async addDependency(
    userId: string,
    taskId: number,
    dependsOnId: number,
    type?: string,
    lagMinutes?: number,
  ) {
    const task = await this.verifyTaskOwnership(userId, taskId);
    const dep = await this.verifyTaskOwnership(userId, dependsOnId);

    if (task.goalId !== dep.goalId) {
      throw new BadRequestException("Tasks must belong to the same goal");
    }

    return this.depsRepo.create({
      taskId,
      dependsOnId,
      dependencyType: (type as any) ?? "finish_to_start",
      lagMinutes: lagMinutes ?? 0,
    });
  }

  async removeDependency(
    userId: string,
    taskId: number,
    dependsOnId: number,
  ) {
    await this.verifyTaskOwnership(userId, taskId);
    const deleted = await this.depsRepo.delete(taskId, dependsOnId);
    if (!deleted) {
      throw new NotFoundException("Dependency not found");
    }
    return deleted;
  }
}
