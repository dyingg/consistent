import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { GoalsRepository } from "./goals.repository";

export interface CreateGoalInput {
  title: string;
  description?: string | null;
  descriptionContext?: string | null;
  color?: string | null;
  targetDate?: string | null;
  priority?: number;
}

export interface UpdateGoalInput {
  title?: string;
  description?: string | null;
  descriptionContext?: string | null;
  color?: string | null;
  status?: "active" | "completed" | "paused" | "abandoned";
  targetDate?: string | null;
  priority?: number;
}

@Injectable()
export class GoalsService {
  constructor(private readonly goalsRepo: GoalsRepository) {}

  async create(userId: string, data: CreateGoalInput) {
    const title = data.title?.trim();
    if (!title) {
      throw new BadRequestException("Title is required");
    }
    return this.goalsRepo.create({ ...data, title, userId });
  }

  async findAll(userId: string, status?: string) {
    return this.goalsRepo.findByUserId(userId, status);
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

    const updateData: Record<string, unknown> = { ...data };

    if (data.status === "completed") {
      updateData.completedAt = new Date();
    } else if (data.status) {
      updateData.completedAt = null;
    }

    return this.goalsRepo.update(goalId, updateData as any);
  }

  async delete(userId: string, goalId: number) {
    await this.findById(userId, goalId);
    return this.goalsRepo.delete(goalId);
  }

  async getProgress(userId: string, goalId: number) {
    await this.findById(userId, goalId);
    return this.goalsRepo.getProgress(goalId);
  }
}
