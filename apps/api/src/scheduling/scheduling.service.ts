import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { SchedulingRepository } from "./scheduling.repository";
import { TasksRepository } from "../tasks/tasks.repository";

export interface CreateBlockInput {
  taskId: number;
  startTime: Date;
  endTime: Date;
  scheduledBy?: "llm" | "user" | "recurring";
  scheduleRunId?: number | null;
}

@Injectable()
export class SchedulingService {
  constructor(
    private readonly schedulingRepo: SchedulingRepository,
    private readonly tasksRepo: TasksRepository,
  ) {}

  private async verifyBlockOwnership(userId: string, blockId: number) {
    const block = await this.schedulingRepo.findBlockById(blockId);
    if (!block || block.userId !== userId) {
      throw new NotFoundException("Scheduled block not found");
    }
    return block;
  }

  async createBlock(userId: string, data: CreateBlockInput) {
    const task = await this.tasksRepo.findById(data.taskId);
    if (!task || task.userId !== userId) {
      throw new NotFoundException("Task not found");
    }

    const startTime = new Date(data.startTime);
    const endTime = new Date(data.endTime);

    if (startTime >= endTime) {
      throw new BadRequestException("Start time must be before end time");
    }

    return this.schedulingRepo.createBlock({
      userId,
      taskId: data.taskId,
      startTime,
      endTime,
      scheduledBy: data.scheduledBy,
      scheduleRunId: data.scheduleRunId,
    });
  }

  async getBlocksForRange(userId: string, start: Date, end: Date) {
    if (start >= end) {
      throw new BadRequestException("Start must be before end");
    }
    return this.schedulingRepo.getBlocksForRangeWithDetails(userId, start, end);
  }

  async getCurrentBlock(userId: string) {
    return this.schedulingRepo.getCurrentBlock(userId);
  }

  async updateBlockStatus(
    userId: string,
    blockId: number,
    status: "planned" | "confirmed" | "completed" | "missed" | "moved",
  ) {
    await this.verifyBlockOwnership(userId, blockId);
    return this.schedulingRepo.updateBlockStatus(blockId, status);
  }

  async deleteBlock(userId: string, blockId: number) {
    await this.verifyBlockOwnership(userId, blockId);
    return this.schedulingRepo.deleteBlock(blockId);
  }
}
