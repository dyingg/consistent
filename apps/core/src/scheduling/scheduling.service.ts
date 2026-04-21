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

export type BulkConflict =
  | {
      inputIndex: number;
      kind: "existing";
      blockId: number;
      taskId: number;
      taskTitle: string;
      startTime: string;
      endTime: string;
    }
  | {
      inputIndex: number;
      kind: "cohort";
      otherInputIndex: number;
      taskId: number;
      taskTitle: string;
      startTime: string;
      endTime: string;
    };

export type ShiftBlocksInput =
  | { blockIds: number[]; deltaMinutes: number; afterTime?: undefined }
  | { afterTime: Date; deltaMinutes: number; blockIds?: undefined };

type ConflictCandidate = {
  id: number;
  taskId: number;
  taskTitle: string;
  startTime: Date;
  endTime: Date;
};

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

    await this.assertNoConflicts(userId, [{ startTime, endTime }]);

    const block = await this.schedulingRepo.createBlock({
      userId,
      taskId: data.taskId,
      startTime,
      endTime,
      scheduledBy: data.scheduledBy,
      scheduleRunId: data.scheduleRunId,
    });

    this.realtime.broadcastToUser(userId, EVENTS.SCHEDULE_UPDATED, {
      blockId: block.id,
    });
    return { block, conflicts: [] };
  }

  async bulkCreateBlocks(userId: string, data: CreateBlockInput[]) {
    if (data.length === 0) {
      throw new BadRequestException("At least one block is required");
    }

    const normalized = data.map((d, inputIndex) => {
      const startTime = new Date(d.startTime);
      const endTime = new Date(d.endTime);
      if (startTime >= endTime) {
        throw new BadRequestException("Start time must be before end time");
      }
      return { ...d, startTime, endTime, inputIndex };
    });

    const taskIds = Array.from(new Set(normalized.map((d) => d.taskId)));
    const ownedTasks = await this.tasksRepo.findByIds(taskIds);
    if (
      ownedTasks.length !== taskIds.length ||
      ownedTasks.some((t) => t.userId !== userId)
    ) {
      throw new NotFoundException("One or more tasks not found");
    }
    const taskTitles = new Map(ownedTasks.map((t) => [t.id, t.title]));

    const minStart = normalized.reduce(
      (acc, d) => (d.startTime < acc ? d.startTime : acc),
      normalized[0]!.startTime,
    );
    const maxEnd = normalized.reduce(
      (acc, d) => (d.endTime > acc ? d.endTime : acc),
      normalized[0]!.endTime,
    );
    const candidates = await this.schedulingRepo.findOverlapping(
      userId,
      minStart,
      maxEnd,
    );

    const conflicts: BulkConflict[] = [];
    for (const b of normalized) {
      for (const c of candidates) {
        if (c.startTime < b.endTime && c.endTime > b.startTime) {
          conflicts.push({
            inputIndex: b.inputIndex,
            kind: "existing",
            blockId: c.id,
            taskId: c.taskId,
            taskTitle: c.taskTitle,
            startTime: c.startTime.toISOString(),
            endTime: c.endTime.toISOString(),
          });
        }
      }
      for (const other of normalized) {
        if (other.inputIndex <= b.inputIndex) continue;
        if (other.startTime < b.endTime && other.endTime > b.startTime) {
          conflicts.push({
            inputIndex: b.inputIndex,
            kind: "cohort",
            otherInputIndex: other.inputIndex,
            taskId: other.taskId,
            taskTitle: taskTitles.get(other.taskId) ?? "(unknown task)",
            startTime: other.startTime.toISOString(),
            endTime: other.endTime.toISOString(),
          });
        }
      }
    }

    if (conflicts.length > 0) {
      return { blocks: [], conflicts };
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

    this.realtime.broadcastToUser(userId, EVENTS.SCHEDULE_UPDATED, {});
    return { blocks, conflicts: [] };
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

  private summarizeConflicts(
    rawConflicts: ConflictCandidate[],
  ): ConflictSummary[] {
    return rawConflicts.map((c) => ({
      blockId: c.id,
      taskId: c.taskId,
      taskTitle: c.taskTitle,
      startTime: c.startTime.toISOString(),
      endTime: c.endTime.toISOString(),
    }));
  }

  private async assertNoConflicts(
    userId: string,
    windows: Array<{ startTime: Date; endTime: Date }>,
    excludeIds: number[] = [],
  ) {
    const conflictsById = new Map<number, ConflictCandidate>();
    for (const window of windows) {
      const conflicts = await this.schedulingRepo.findOverlapping(
        userId,
        window.startTime,
        window.endTime,
        excludeIds,
      );
      for (const conflict of conflicts) {
        conflictsById.set(conflict.id, conflict);
      }
    }

    if (conflictsById.size === 0) return;

    throw new BadRequestException({
      message: "Scheduled block conflicts with existing blocks",
      conflicts: this.summarizeConflicts([...conflictsById.values()]),
    });
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

    if (patch.startTime !== undefined || patch.endTime !== undefined) {
      await this.assertNoConflicts(
        userId,
        [{ startTime: effectiveStart, endTime: effectiveEnd }],
        [blockId],
      );
    }

    const updated = await this.schedulingRepo.updateBlock(blockId, patch);
    if (!updated) throw new NotFoundException("Scheduled block not found");

    this.realtime.broadcastToUser(userId, EVENTS.SCHEDULE_UPDATED, { blockId });
    return { block: updated, conflicts: [] };
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
    let blocksToShift: ScheduledBlock[];
    if (hasIds) {
      ids = input.blockIds!;
      blocksToShift = [];
      for (const id of ids) {
        blocksToShift.push(await this.verifyBlockOwnership(userId, id));
      }
    } else {
      const far = new Date("9999-12-31T00:00:00Z");
      const blocks = await this.schedulingRepo.getBlocksForRange(
        userId,
        input.afterTime!,
        far,
      );
      ids = blocks.map((b) => b.id);
      blocksToShift = blocks;
    }

    if (ids.length === 0) {
      return { blocks: [], conflicts: [] };
    }

    const shiftedWindows = blocksToShift.map((block) => ({
      startTime: new Date(
        block.startTime.getTime() + input.deltaMinutes * 60_000,
      ),
      endTime: new Date(block.endTime.getTime() + input.deltaMinutes * 60_000),
    }));
    await this.assertNoConflicts(userId, shiftedWindows, ids);

    const shifted = await this.schedulingRepo.shiftBlocks(
      ids,
      input.deltaMinutes,
    );
    shifted.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    this.realtime.broadcastToUser(userId, EVENTS.SCHEDULE_UPDATED, {});

    return { blocks: shifted, conflicts: [] };
  }

  async deleteBlock(userId: string, blockId: number) {
    await this.verifyBlockOwnership(userId, blockId);
    const deleted = await this.schedulingRepo.deleteBlock(blockId);
    if (!deleted) throw new NotFoundException("Scheduled block not found");
    this.realtime.broadcastToUser(userId, EVENTS.SCHEDULE_UPDATED, { blockId });
    return deleted;
  }
}
