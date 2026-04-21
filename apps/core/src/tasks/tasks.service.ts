import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { tasks, taskDependencies } from "@consistent/db/schema";

type TaskInsert = typeof tasks.$inferInsert;
type DependencyType = (typeof taskDependencies.$inferInsert)["dependencyType"];

import { EVENTS } from "@consistent/realtime";
import { TasksRepository } from "./tasks.repository";
import { DependenciesRepository } from "./dependencies.repository";
import { GoalsRepository } from "../goals/goals.repository";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { DRIZZLE, type DrizzleDB } from "../db";

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  context?: string | null;
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
  context?: string | null;
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
    private readonly realtime: RealtimeGateway,
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

    const task = await this.tasksRepo.create({ ...data, title, userId, goalId });
    this.realtime.broadcastToUser(userId, EVENTS.TASK_UPDATED, { taskId: task.id, goalId });
    this.realtime.broadcastToUser(userId, EVENTS.GOAL_UPDATED, { goalId });
    return task;
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

    const result = await this.db.transaction(async (tx) => {
      const taskRows = input.tasks.map((t) => ({
        goalId,
        userId,
        title: t.title.trim(),
        description: t.description,
        context: t.context,
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

    this.realtime.broadcastToUser(userId, EVENTS.GOAL_UPDATED, { goalId });
    return result;
  }

  async findAllForGoal(userId: string, goalId: number) {
    await this.verifyGoalOwnership(userId, goalId);
    return this.tasksRepo.findByGoalId(goalId);
  }

  async findAllForUser(
    userId: string,
    { limit, offset }: { limit: number; offset: number },
  ) {
    const clampedLimit = Math.max(1, Math.min(100, limit));
    const clampedOffset = Math.max(0, offset);
    return this.tasksRepo.findAllForUserPaginated(
      userId,
      clampedLimit,
      clampedOffset,
    );
  }

  async findById(userId: string, taskId: number) {
    return this.verifyTaskOwnership(userId, taskId);
  }

  async update(userId: string, taskId: number, data: UpdateTaskInput) {
    const task = await this.verifyTaskOwnership(userId, taskId);

    if (data.title !== undefined) {
      const title = data.title.trim();
      if (!title) {
        throw new BadRequestException("Title is required");
      }
      data.title = title;
    }

    const updateData: Partial<TaskInsert> = { ...data };

    if (data.status === "completed") {
      updateData.completedAt = new Date();
    } else if (data.status) {
      updateData.completedAt = null;
    }

    const updated = await this.tasksRepo.update(taskId, updateData);
    this.realtime.broadcastToUser(userId, EVENTS.TASK_UPDATED, { taskId, goalId: task.goalId });
    this.realtime.broadcastToUser(userId, EVENTS.GOAL_UPDATED, { goalId: task.goalId });
    return updated;
  }

  async delete(userId: string, taskId: number) {
    const task = await this.verifyTaskOwnership(userId, taskId);
    const deleted = await this.tasksRepo.delete(taskId);
    this.realtime.broadcastToUser(userId, EVENTS.TASK_UPDATED, { taskId, goalId: task.goalId });
    this.realtime.broadcastToUser(userId, EVENTS.GOAL_UPDATED, { goalId: task.goalId });
    return deleted;
  }

  async bulkDelete(userId: string, taskIds: number[]) {
    if (!taskIds.length) {
      throw new BadRequestException("At least one taskId is required");
    }

    const uniqueIds = Array.from(new Set(taskIds));
    const rows = await this.tasksRepo.findByIds(uniqueIds);

    // All-or-nothing authorization. Use the same message for missing and
    // foreign-owned so callers cannot enumerate task ids.
    if (
      rows.length !== uniqueIds.length ||
      rows.some((r) => r.userId !== userId)
    ) {
      throw new NotFoundException("One or more tasks not found");
    }

    const deleted = await this.tasksRepo.deleteMany(uniqueIds);

    const affectedGoals = new Set<number>();
    for (const r of rows) {
      affectedGoals.add(r.goalId);
      this.realtime.broadcastToUser(userId, EVENTS.TASK_UPDATED, {
        taskId: r.id,
        goalId: r.goalId,
      });
    }
    for (const goalId of affectedGoals) {
      this.realtime.broadcastToUser(userId, EVENTS.GOAL_UPDATED, { goalId });
    }

    return { deletedIds: deleted.map((d) => d.id), count: deleted.length };
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
      dependencyType: (type as DependencyType) ?? "finish_to_start",
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
