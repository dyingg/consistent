import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { goals } from "@consistent/db/schema";
import { GoalsRepository } from "./goals.repository";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { EVENTS } from "@consistent/realtime";

type GoalInsert = typeof goals.$inferInsert;

export interface CreateGoalInput {
  title: string;
  description?: string | null;
  context?: string | null;
  color?: string | null;
  targetDate?: string | null;
  priority?: number;
}

export interface UpdateGoalInput {
  title?: string;
  description?: string | null;
  context?: string | null;
  color?: string | null;
  status?: "active" | "completed" | "paused" | "abandoned";
  targetDate?: string | null;
  priority?: number;
}

@Injectable()
export class GoalsService {
  constructor(
    private readonly goalsRepo: GoalsRepository,
    private readonly realtime: RealtimeGateway,
  ) {}

  async create(userId: string, data: CreateGoalInput) {
    const title = data.title?.trim();
    if (!title) {
      throw new BadRequestException("Title is required");
    }
    const goal = await this.goalsRepo.create({ ...data, title, userId });
    this.realtime.broadcastToUser(userId, EVENTS.GOAL_UPDATED, { goalId: goal.id });
    return goal;
  }

  async findAll(userId: string, status?: string) {
    const rows = await this.goalsRepo.findByUserId(userId, status);
    return rows.map((goal) => ({
      ...goal,
      progress:
        goal.totalTasks > 0
          ? Math.round((goal.completedTasks / goal.totalTasks) * 100)
          : 0,
    }));
  }

  async findById(userId: string, goalId: number) {
    const goal = await this.goalsRepo.findById(goalId);
    if (!goal || goal.userId !== userId) {
      throw new NotFoundException("Goal not found");
    }
    return goal;
  }

  async update(userId: string, goalId: number, data: UpdateGoalInput) {
    await this.findById(userId, goalId);

    if (data.title !== undefined) {
      const title = data.title.trim();
      if (!title) {
        throw new BadRequestException("Title is required");
      }
      data.title = title;
    }

    const updateData: Partial<GoalInsert> = { ...data };

    if (data.status === "completed") {
      updateData.completedAt = new Date();
    } else if (data.status) {
      updateData.completedAt = null;
    }

    const updated = await this.goalsRepo.update(goalId, updateData);
    this.realtime.broadcastToUser(userId, EVENTS.GOAL_UPDATED, { goalId });
    return updated;
  }

  async delete(userId: string, goalId: number) {
    await this.findById(userId, goalId);
    const deleted = await this.goalsRepo.delete(goalId);
    this.realtime.broadcastToUser(userId, EVENTS.GOAL_UPDATED, { goalId });
    return deleted;
  }

  async getProgress(userId: string, goalId: number) {
    await this.findById(userId, goalId);
    return this.goalsRepo.getProgress(goalId);
  }
}
