import { scheduledBlocks } from "@consistent/db/schema";
import { EVENTS } from "@consistent/realtime";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { TasksRepository } from "../tasks/tasks.repository";
import { SchedulingRepository } from "./scheduling.repository";

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

type ProposedScheduleWindow = {
  inputIndex: number;
  taskId: number;
  startTime: Date;
  endTime: Date;
  blockId?: number;
};

type ConflictCandidate = {
  id: number;
  taskId: number;
  taskTitle: string;
  startTime: Date;
  endTime: Date;
};

export type ScheduleConflict =
  | {
      inputIndex: number;
      kind: "existing";
      blockId: number;
      taskId: number;
      taskTitle: string;
      startTime: string;
      endTime: string;
      attemptedTaskId: number;
      attemptedStartTime: string;
      attemptedEndTime: string;
      attemptedBlockId?: number;
    }
  | {
      inputIndex: number;
      kind: "cohort";
      otherInputIndex: number;
      taskId: number;
      taskTitle: string | null;
      startTime: string;
      endTime: string;
      attemptedTaskId: number;
      attemptedStartTime: string;
      attemptedEndTime: string;
      attemptedBlockId?: number;
      otherAttemptedBlockId?: number;
    };

export type BulkConflict = ScheduleConflict;

export type ShiftBlocksInput =
  | { blockIds: number[]; deltaMinutes: number; afterTime?: undefined }
  | { afterTime: Date; deltaMinutes: number; blockIds?: undefined };

@Injectable()
export class SchedulingService {
  constructor(
    private readonly schedulingRepo: SchedulingRepository,
    private readonly tasksRepo: TasksRepository,
    private readonly realtime: RealtimeGateway
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

    const conflicts = await this.collectScheduleConflicts(userId, [
      {
        inputIndex: 0,
        taskId: data.taskId,
        startTime,
        endTime,
      },
    ]);
    this.throwIfConflicts(conflicts);

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

    const windows = normalized.map((d) => ({
      inputIndex: d.inputIndex,
      taskId: d.taskId,
      startTime: d.startTime,
      endTime: d.endTime,
    }));
    const conflicts = await this.collectScheduleConflicts(userId, windows, {
      includeCohort: true,
      taskTitles,
    });

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

  private overlaps(
    left: { startTime: Date; endTime: Date },
    right: { startTime: Date; endTime: Date }
  ) {
    return left.startTime < right.endTime && left.endTime > right.startTime;
  }

  private toExistingConflict(
    window: ProposedScheduleWindow,
    candidate: ConflictCandidate
  ): ScheduleConflict {
    return {
      inputIndex: window.inputIndex,
      kind: "existing",
      blockId: candidate.id,
      taskId: candidate.taskId,
      taskTitle: candidate.taskTitle,
      startTime: candidate.startTime.toISOString(),
      endTime: candidate.endTime.toISOString(),
      attemptedTaskId: window.taskId,
      attemptedStartTime: window.startTime.toISOString(),
      attemptedEndTime: window.endTime.toISOString(),
      ...(window.blockId === undefined
        ? {}
        : { attemptedBlockId: window.blockId }),
    };
  }

  private toCohortConflict(
    window: ProposedScheduleWindow,
    other: ProposedScheduleWindow,
    taskTitles: Map<number, string>
  ): ScheduleConflict {
    return {
      inputIndex: window.inputIndex,
      kind: "cohort",
      otherInputIndex: other.inputIndex,
      taskId: other.taskId,
      taskTitle: taskTitles.get(other.taskId) ?? "(unknown task)",
      startTime: other.startTime.toISOString(),
      endTime: other.endTime.toISOString(),
      attemptedTaskId: window.taskId,
      attemptedStartTime: window.startTime.toISOString(),
      attemptedEndTime: window.endTime.toISOString(),
      ...(window.blockId === undefined
        ? {}
        : { attemptedBlockId: window.blockId }),
      ...(other.blockId === undefined
        ? {}
        : { otherAttemptedBlockId: other.blockId }),
    };
  }

  private async collectScheduleConflicts(
    userId: string,
    windows: ProposedScheduleWindow[],
    options: {
      excludeIds?: number[];
      includeCohort?: boolean;
      taskTitles?: Map<number, string>;
    } = {}
  ): Promise<ScheduleConflict[]> {
    if (windows.length === 0) return [];

    const minStart = windows.reduce(
      (acc, window) => (window.startTime < acc ? window.startTime : acc),
      windows[0]!.startTime
    );
    const maxEnd = windows.reduce(
      (acc, window) => (window.endTime > acc ? window.endTime : acc),
      windows[0]!.endTime
    );
    const candidates = await this.schedulingRepo.findOverlapping(
      userId,
      minStart,
      maxEnd,
      options.excludeIds
    );

    const conflicts: ScheduleConflict[] = [];
    for (const window of windows) {
      for (const candidate of candidates) {
        if (this.overlaps(window, candidate)) {
          conflicts.push(this.toExistingConflict(window, candidate));
        }
      }
      if (!options.includeCohort) continue;
      for (const other of windows) {
        if (other.inputIndex <= window.inputIndex) continue;
        if (this.overlaps(window, other)) {
          conflicts.push(
            this.toCohortConflict(
              window,
              other,
              options.taskTitles ?? new Map()
            )
          );
        }
      }
    }

    return conflicts;
  }

  private throwIfConflicts(conflicts: ScheduleConflict[]) {
    if (conflicts.length === 0) return;

    throw new BadRequestException({
      message: "Scheduled block conflicts with existing blocks",
      conflicts,
    });
  }

  async updateBlock(
    userId: string,
    blockId: number,
    patch: UpdateBlockPatch
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
      const conflicts = await this.collectScheduleConflicts(
        userId,
        [
          {
            inputIndex: 0,
            blockId,
            taskId: patch.taskId ?? existing.taskId,
            startTime: effectiveStart,
            endTime: effectiveEnd,
          },
        ],
        { excludeIds: [blockId] }
      );
      this.throwIfConflicts(conflicts);
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
        "Provide exactly one of blockIds or afterTime"
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
        far
      );
      ids = blocks.map((b) => b.id);
      blocksToShift = blocks;
    }

    if (ids.length === 0) {
      return { blocks: [], conflicts: [] };
    }

    const shiftedWindows = blocksToShift.map((block, inputIndex) => ({
      inputIndex,
      blockId: block.id,
      taskId: block.taskId,
      startTime: new Date(
        block.startTime.getTime() + input.deltaMinutes * 60_000
      ),
      endTime: new Date(block.endTime.getTime() + input.deltaMinutes * 60_000),
    }));
    const conflicts = await this.collectScheduleConflicts(
      userId,
      shiftedWindows,
      {
        excludeIds: ids,
      }
    );
    this.throwIfConflicts(conflicts);

    const shifted = await this.schedulingRepo.shiftBlocks(
      ids,
      input.deltaMinutes
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
