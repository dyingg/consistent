import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { EVENTS } from "@consistent/realtime";
import { scheduledBlocks } from "@consistent/db/schema";
import { SchedulingRepository } from "./scheduling.repository";
import { TasksRepository } from "../tasks/tasks.repository";
import { RealtimeGateway } from "../realtime/realtime.gateway";

type ScheduledBlock = typeof scheduledBlocks.$inferSelect;

export interface CreateBlockInput {
  taskId: number;
  startTime: Date;
  endTime: Date;
  scheduledBy?: "llm" | "user" | "recurring";
  scheduleRunId?: number | null;
}

export interface UpdateBlockPatch {
  status?: "planned" | "confirmed" | "completed" | "missed" | "moved";
  startTime?: Date;
  endTime?: Date;
  taskId?: number;
}

export interface ConflictSummary {
  blockId: number;
  taskId: number;
  taskTitle: string;
  startTime: string;
  endTime: string;
}

export type ShiftBlocksInput =
  | { blockIds: number[]; deltaMinutes: number; afterTime?: undefined }
  | { afterTime: Date; deltaMinutes: number; blockIds?: undefined };

@Injectable()
export class SchedulingService {
  constructor(
    private readonly schedulingRepo: SchedulingRepository,
    private readonly tasksRepo: TasksRepository,
    private readonly realtime: RealtimeGateway,
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

    const block = await this.schedulingRepo.createBlock({
      userId,
      taskId: data.taskId,
      startTime,
      endTime,
      scheduledBy: data.scheduledBy,
      scheduleRunId: data.scheduleRunId,
    });
    const rawConflicts = await this.schedulingRepo.findOverlapping(
      userId,
      startTime,
      endTime,
      [block.id],
    );
    const conflicts = await this.summarizeConflicts(rawConflicts);

    this.realtime.broadcastToUser(userId, EVENTS.SCHEDULE_UPDATED, {
      blockId: block.id,
    });
    return { block, conflicts };
  }

  async bulkCreateBlocks(userId: string, data: CreateBlockInput[]) {
    if (data.length === 0) {
      throw new BadRequestException("At least one block is required");
    }

    const normalized = data.map((d) => {
      const startTime = new Date(d.startTime);
      const endTime = new Date(d.endTime);
      if (startTime >= endTime) {
        throw new BadRequestException("Start time must be before end time");
      }
      return { ...d, startTime, endTime };
    });

    const taskIds = Array.from(new Set(normalized.map((d) => d.taskId)));
    const ownedTasks = await this.tasksRepo.findByIds(taskIds);
    if (
      ownedTasks.length !== taskIds.length ||
      ownedTasks.some((t) => t.userId !== userId)
    ) {
      throw new NotFoundException("One or more tasks not found");
    }

    const rows = normalized.map((d) => ({
      userId,
      taskId: d.taskId,
      startTime: d.startTime,
      endTime: d.endTime,
      scheduledBy: d.scheduledBy,
      scheduleRunId: d.scheduleRunId,
    }));
    const blocks = await this.schedulingRepo.createBlocks(rows);

    const newIds = blocks.map((b) => b.id);
    const minStart = blocks.reduce(
      (acc, b) => (b.startTime < acc ? b.startTime : acc),
      blocks[0]!.startTime,
    );
    const maxEnd = blocks.reduce(
      (acc, b) => (b.endTime > acc ? b.endTime : acc),
      blocks[0]!.endTime,
    );
    const rawConflicts = await this.schedulingRepo.findOverlapping(
      userId,
      minStart,
      maxEnd,
      newIds,
    );
    const conflicts = await this.summarizeConflicts(rawConflicts);

    this.realtime.broadcastToUser(userId, EVENTS.SCHEDULE_UPDATED, {});
    return { blocks, conflicts };
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

  private async summarizeConflicts(
    rawConflicts: Array<{
      id: number;
      taskId: number;
      startTime: Date;
      endTime: Date;
    }>,
  ): Promise<ConflictSummary[]> {
    const summaries: ConflictSummary[] = [];
    for (const c of rawConflicts) {
      const task = await this.tasksRepo.findById(c.taskId);
      summaries.push({
        blockId: c.id,
        taskId: c.taskId,
        taskTitle: task?.title ?? "(unknown task)",
        startTime: c.startTime.toISOString(),
        endTime: c.endTime.toISOString(),
      });
    }
    return summaries;
  }

  async updateBlock(
    userId: string,
    blockId: number,
    patch: UpdateBlockPatch,
  ): Promise<{ block: ScheduledBlock; conflicts: ConflictSummary[] }> {
    const existing = await this.verifyBlockOwnership(userId, blockId);

    if (patch.taskId !== undefined && patch.taskId !== existing.taskId) {
      const task = await this.tasksRepo.findById(patch.taskId);
      if (!task || task.userId !== userId) {
        throw new NotFoundException("Task not found");
      }
    }

    const effectiveStart = patch.startTime ?? existing.startTime;
    const effectiveEnd = patch.endTime ?? existing.endTime;
    if (effectiveStart >= effectiveEnd) {
      throw new BadRequestException("Start time must be before end time");
    }

    const updated = await this.schedulingRepo.updateBlock(blockId, patch);
    if (!updated) throw new NotFoundException("Scheduled block not found");

    const rawConflicts = await this.schedulingRepo.findOverlapping(
      userId,
      effectiveStart,
      effectiveEnd,
      [blockId],
    );
    const conflicts = await this.summarizeConflicts(rawConflicts);

    this.realtime.broadcastToUser(userId, EVENTS.SCHEDULE_UPDATED, { blockId });
    return { block: updated, conflicts };
  }

  async shiftBlocks(userId: string, input: ShiftBlocksInput) {
    const hasIds = Array.isArray(input.blockIds) && input.blockIds.length > 0;
    const hasAfter = input.afterTime instanceof Date;
    if (hasIds === hasAfter) {
      throw new BadRequestException(
        "Provide exactly one of blockIds or afterTime",
      );
    }
    if (!input.deltaMinutes) {
      throw new BadRequestException("deltaMinutes must be non-zero");
    }

    let ids: number[];
    if (hasIds) {
      ids = input.blockIds!;
      for (const id of ids) {
        await this.verifyBlockOwnership(userId, id);
      }
    } else {
      const far = new Date("9999-12-31T00:00:00Z");
      const blocks = await this.schedulingRepo.getBlocksForRange(
        userId,
        input.afterTime!,
        far,
      );
      ids = blocks.map((b) => b.id);
    }

    if (ids.length === 0) {
      return { blocks: [], conflicts: [] };
    }

    const shifted = await this.schedulingRepo.shiftBlocks(
      ids,
      input.deltaMinutes,
    );
    shifted.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    let rawConflicts: Array<{
      id: number;
      taskId: number;
      startTime: Date;
      endTime: Date;
    }> = [];
    if (shifted.length > 0) {
      const minStart = shifted[0]!.startTime;
      const maxEnd = shifted.reduce(
        (acc, b) => (b.endTime > acc ? b.endTime : acc),
        shifted[0]!.endTime,
      );
      rawConflicts = await this.schedulingRepo.findOverlapping(
        userId,
        minStart,
        maxEnd,
        ids,
      );
    }
    const conflicts = await this.summarizeConflicts(rawConflicts);

    this.realtime.broadcastToUser(userId, EVENTS.SCHEDULE_UPDATED, {});

    return { blocks: shifted, conflicts };
  }

  async deleteBlock(userId: string, blockId: number) {
    await this.verifyBlockOwnership(userId, blockId);
    const deleted = await this.schedulingRepo.deleteBlock(blockId);
    if (!deleted) throw new NotFoundException("Scheduled block not found");
    this.realtime.broadcastToUser(userId, EVENTS.SCHEDULE_UPDATED, { blockId });
    return deleted;
  }
}
