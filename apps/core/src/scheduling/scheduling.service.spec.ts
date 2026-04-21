/* eslint-disable @typescript-eslint/no-explicit-any --
 * Test mocks legitimately use `any` for two patterns Jest+ts-jest cannot
 * easily type without losing readability:
 *   1. Chainable Drizzle query mocks (e.g. db.select().from().where().limit())
 *      where each step returns the same chainable object — typing this fully
 *      requires recursive generics that obscure the test intent.
 *   2. mockResolvedValue(mockEntity as any) where the literal mock skips
 *      fields like createdAt/updatedAt that the production type requires
 *      but the assertion under test does not care about.
 * Production code in apps/core has the rule at error and is fully clean.
 */
import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";

jest.mock("../db", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory cannot reference outer-scope vars; require() is the documented escape
  DRIZZLE: require("../db/types").DRIZZLE,
}));

import { SchedulingService } from "./scheduling.service";
import { SchedulingRepository } from "./scheduling.repository";
import { TasksRepository } from "../tasks/tasks.repository";
import { RealtimeGateway } from "../realtime/realtime.gateway";

describe("SchedulingService", () => {
  let service: SchedulingService;
  let schedulingRepo: jest.Mocked<SchedulingRepository>;
  let tasksRepo: jest.Mocked<TasksRepository>;

  const userId = "user-1";
  const otherUserId = "user-2";

  const mockTask = {
    id: 10,
    goalId: 1,
    userId,
    title: "Read chapter 1",
    status: "pending",
    createdAt: new Date(),
  };

  const mockBlock = {
    id: 1,
    taskId: 10,
    userId,
    startTime: new Date("2026-04-16T09:00:00Z"),
    endTime: new Date("2026-04-16T10:00:00Z"),
    status: "planned" as const,
    scheduledBy: "user" as const,
    scheduleRunId: null,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulingService,
        {
          provide: SchedulingRepository,
          useValue: {
            findBlockById: jest.fn(),
            createBlock: jest.fn(),
            getBlocksForRange: jest.fn(),
            getBlocksForRangeWithDetails: jest.fn(),
            getCurrentBlock: jest.fn(),
            updateBlock: jest.fn(),
            findOverlapping: jest.fn(),
            shiftBlocks: jest.fn(),
            deleteBlock: jest.fn(),
          },
        },
        {
          provide: TasksRepository,
          useValue: {
            findById: jest.fn(),
          },
        },
        {
          provide: RealtimeGateway,
          useValue: {
            broadcastToUser: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SchedulingService>(SchedulingService);
    schedulingRepo = module.get(SchedulingRepository);
    tasksRepo = module.get(TasksRepository);
  });

  // ── createBlock ─────────────────────────────────────────

  describe("createBlock", () => {
    it("should create a block for an owned task", async () => {
      tasksRepo.findById.mockResolvedValue(mockTask as any);
      schedulingRepo.createBlock.mockResolvedValue(mockBlock as any);
      schedulingRepo.findOverlapping.mockResolvedValue([]);

      const result = await service.createBlock(userId, {
        taskId: 10,
        startTime: new Date("2026-04-16T09:00:00Z"),
        endTime: new Date("2026-04-16T10:00:00Z"),
        scheduledBy: "user",
      });

      expect(result).toEqual({ block: mockBlock, conflicts: [] });
      expect(schedulingRepo.createBlock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          taskId: 10,
          scheduledBy: "user",
        }),
      );
    });

    it("should throw NotFoundException when task does not exist", async () => {
      tasksRepo.findById.mockResolvedValue(null);

      await expect(
        service.createBlock(userId, {
          taskId: 999,
          startTime: new Date("2026-04-16T09:00:00Z"),
          endTime: new Date("2026-04-16T10:00:00Z"),
        }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.createBlock(userId, {
          taskId: 999,
          startTime: new Date("2026-04-16T09:00:00Z"),
          endTime: new Date("2026-04-16T10:00:00Z"),
        }),
      ).rejects.toThrow("Task not found");
    });

    it("should throw NotFoundException when task belongs to another user", async () => {
      tasksRepo.findById.mockResolvedValue(mockTask as any);

      await expect(
        service.createBlock(otherUserId, {
          taskId: 10,
          startTime: new Date("2026-04-16T09:00:00Z"),
          endTime: new Date("2026-04-16T10:00:00Z"),
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when startTime equals endTime", async () => {
      tasksRepo.findById.mockResolvedValue(mockTask as any);
      const sameTime = new Date("2026-04-16T09:00:00Z");

      await expect(
        service.createBlock(userId, {
          taskId: 10,
          startTime: sameTime,
          endTime: sameTime,
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createBlock(userId, {
          taskId: 10,
          startTime: sameTime,
          endTime: sameTime,
        }),
      ).rejects.toThrow("Start time must be before end time");
    });

    it("should throw BadRequestException when startTime is after endTime", async () => {
      tasksRepo.findById.mockResolvedValue(mockTask as any);

      await expect(
        service.createBlock(userId, {
          taskId: 10,
          startTime: new Date("2026-04-16T11:00:00Z"),
          endTime: new Date("2026-04-16T10:00:00Z"),
        }),
      ).rejects.toThrow("Start time must be before end time");
    });

    it("should pass optional scheduledBy and scheduleRunId", async () => {
      tasksRepo.findById.mockResolvedValue(mockTask as any);
      schedulingRepo.createBlock.mockResolvedValue(mockBlock as any);
      schedulingRepo.findOverlapping.mockResolvedValue([]);

      await service.createBlock(userId, {
        taskId: 10,
        startTime: new Date("2026-04-16T09:00:00Z"),
        endTime: new Date("2026-04-16T10:00:00Z"),
        scheduledBy: "llm",
        scheduleRunId: 42,
      });

      expect(schedulingRepo.createBlock).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduledBy: "llm",
          scheduleRunId: 42,
        }),
      );
    });

    it("should reject and not create when the block overlaps another block", async () => {
      const conflicting = {
        id: 7,
        taskId: 11,
        taskTitle: "Run",
        startTime: new Date("2026-04-16T09:30:00Z"),
        endTime: new Date("2026-04-16T10:30:00Z"),
      };
      tasksRepo.findById.mockResolvedValue(mockTask as any);
      schedulingRepo.findOverlapping.mockResolvedValue([conflicting] as any);

      let caught: unknown;
      try {
        await service.createBlock(userId, {
          taskId: 10,
          startTime: new Date("2026-04-16T09:00:00Z"),
          endTime: new Date("2026-04-16T10:00:00Z"),
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      expect((caught as BadRequestException).getResponse()).toMatchObject({
        message: "Scheduled block conflicts with existing blocks",
        conflicts: [
          {
            inputIndex: 0,
            kind: "existing",
            blockId: 7,
            taskId: 11,
            taskTitle: "Run",
            startTime: conflicting.startTime.toISOString(),
            endTime: conflicting.endTime.toISOString(),
            attemptedTaskId: 10,
            attemptedStartTime: new Date("2026-04-16T09:00:00Z").toISOString(),
            attemptedEndTime: new Date("2026-04-16T10:00:00Z").toISOString(),
          },
        ],
      });
      expect(schedulingRepo.createBlock).not.toHaveBeenCalled();
    });
  });

  // ── bulkCreateBlocks ────────────────────────────────────

  describe("bulkCreateBlocks", () => {
    const mkInput = (
      taskId: number,
      startIso: string,
      endIso: string,
    ) => ({
      taskId,
      startTime: new Date(startIso),
      endTime: new Date(endIso),
      scheduledBy: "llm" as const,
    });

    it("inserts multiple blocks and emits a schedule event when there are no conflicts", async () => {
      const task1 = { ...mockTask, id: 10 };
      const task2 = { ...mockTask, id: 11 };
      (tasksRepo as any).findByIds = jest.fn().mockResolvedValue([task1, task2]);
      schedulingRepo.findOverlapping.mockResolvedValue([]);
      (schedulingRepo as any).createBlocks = jest.fn().mockResolvedValue([
        {
          ...mockBlock,
          id: 1,
          taskId: 10,
          startTime: new Date("2026-04-16T09:00:00Z"),
          endTime: new Date("2026-04-16T10:00:00Z"),
        },
        {
          ...mockBlock,
          id: 2,
          taskId: 11,
          startTime: new Date("2026-04-16T10:00:00Z"),
          endTime: new Date("2026-04-16T11:00:00Z"),
        },
      ]);

      const result = await service.bulkCreateBlocks(userId, [
        mkInput(10, "2026-04-16T09:00:00Z", "2026-04-16T10:00:00Z"),
        mkInput(11, "2026-04-16T10:00:00Z", "2026-04-16T11:00:00Z"),
      ]);

      expect(result.blocks).toHaveLength(2);
      expect(result.conflicts).toEqual([]);
      expect(schedulingRepo.findOverlapping).toHaveBeenCalledWith(
        userId,
        new Date("2026-04-16T09:00:00Z"),
        new Date("2026-04-16T11:00:00Z"),
      );
      expect((schedulingRepo as any).createBlocks).toHaveBeenCalled();
    });

    it("throws BadRequestException when given an empty array", async () => {
      await expect(service.bulkCreateBlocks(userId, [])).rejects.toThrow(
        "At least one block is required",
      );
    });

    it("throws BadRequestException when any start >= end", async () => {
      await expect(
        service.bulkCreateBlocks(userId, [
          mkInput(10, "2026-04-16T10:00:00Z", "2026-04-16T09:00:00Z"),
        ]),
      ).rejects.toThrow("Start time must be before end time");
    });

    it("throws NotFoundException when any task is not owned", async () => {
      (tasksRepo as any).findByIds = jest.fn().mockResolvedValue([
        { ...mockTask, id: 10 },
      ]);

      await expect(
        service.bulkCreateBlocks(userId, [
          mkInput(10, "2026-04-16T09:00:00Z", "2026-04-16T10:00:00Z"),
          mkInput(999, "2026-04-16T10:00:00Z", "2026-04-16T11:00:00Z"),
        ]),
      ).rejects.toThrow(NotFoundException);
    });

    it("rejects all blocks when any collides with an existing block (all-or-nothing)", async () => {
      const task1 = { ...mockTask, id: 10 };
      const task2 = { ...mockTask, id: 11 };
      const existing = {
        ...mockBlock,
        id: 7,
        taskId: 22,
        taskTitle: "Existing",
        startTime: new Date("2026-04-16T09:30:00Z"),
        endTime: new Date("2026-04-16T10:30:00Z"),
      };
      (tasksRepo as any).findByIds = jest.fn().mockResolvedValue([task1, task2]);
      schedulingRepo.findOverlapping.mockResolvedValue([existing] as any);
      (schedulingRepo as any).createBlocks = jest.fn();

      const result = await service.bulkCreateBlocks(userId, [
        mkInput(10, "2026-04-16T09:00:00Z", "2026-04-16T10:00:00Z"),
        mkInput(11, "2026-04-16T13:00:00Z", "2026-04-16T14:00:00Z"),
      ]);

      expect(result.blocks).toEqual([]);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]).toMatchObject({
        inputIndex: 0,
        kind: "existing",
        blockId: 7,
        taskTitle: "Existing",
        attemptedTaskId: 10,
        attemptedStartTime: new Date("2026-04-16T09:00:00Z").toISOString(),
        attemptedEndTime: new Date("2026-04-16T10:00:00Z").toISOString(),
      });
      expect((tasksRepo as any).findByIds).toHaveBeenCalledTimes(1);
      expect((schedulingRepo as any).createBlocks).not.toHaveBeenCalled();
    });

    it("rejects all blocks when two cohort entries overlap each other", async () => {
      (tasksRepo as any).findByIds = jest
        .fn()
        .mockResolvedValue([{ ...mockTask, id: 10 }, { ...mockTask, id: 11, title: "Two" }]);
      schedulingRepo.findOverlapping.mockResolvedValue([]);
      (schedulingRepo as any).createBlocks = jest.fn();

      const result = await service.bulkCreateBlocks(userId, [
        mkInput(10, "2026-04-16T09:00:00Z", "2026-04-16T10:00:00Z"),
        mkInput(11, "2026-04-16T09:30:00Z", "2026-04-16T10:30:00Z"),
      ]);

      expect(result.blocks).toEqual([]);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]).toMatchObject({
        inputIndex: 0,
        kind: "cohort",
        otherInputIndex: 1,
        taskTitle: "Two",
        attemptedTaskId: 10,
        attemptedStartTime: new Date("2026-04-16T09:00:00Z").toISOString(),
        attemptedEndTime: new Date("2026-04-16T10:00:00Z").toISOString(),
      });
      expect((schedulingRepo as any).createBlocks).not.toHaveBeenCalled();
    });

    it("does not false-positive existing blocks that fall in the gap of a non-contiguous cohort", async () => {
      // Cohort 9-10 AM + 2-3 PM; existing block 12-1 PM sits in the gap.
      // Previously the bounding-box overlap query flagged it; now we match per-block.
      const task1 = { ...mockTask, id: 10 };
      const task2 = { ...mockTask, id: 11 };
      const lunchBlock = {
        ...mockBlock,
        id: 99,
        taskId: 33,
        taskTitle: "Lunch",
        startTime: new Date("2026-04-16T12:00:00Z"),
        endTime: new Date("2026-04-16T13:00:00Z"),
      };
      (tasksRepo as any).findByIds = jest.fn().mockResolvedValue([task1, task2]);
      schedulingRepo.findOverlapping.mockResolvedValue([lunchBlock] as any);
      (schedulingRepo as any).createBlocks = jest
        .fn()
        .mockResolvedValue([
          { ...mockBlock, id: 1, taskId: 10 },
          { ...mockBlock, id: 2, taskId: 11 },
        ]);

      const result = await service.bulkCreateBlocks(userId, [
        mkInput(10, "2026-04-16T09:00:00Z", "2026-04-16T10:00:00Z"),
        mkInput(11, "2026-04-16T14:00:00Z", "2026-04-16T15:00:00Z"),
      ]);

      expect(result.conflicts).toEqual([]);
      expect(result.blocks).toHaveLength(2);
      expect((tasksRepo as any).findByIds).toHaveBeenCalledTimes(1);
      expect((schedulingRepo as any).createBlocks).toHaveBeenCalled();
    });
  });

  // ── getBlocksForRange ───────────────────────────────────

  describe("getBlocksForRange", () => {
    it("should return blocks within the date range", async () => {
      schedulingRepo.getBlocksForRangeWithDetails.mockResolvedValue([mockBlock] as any);

      const result = await service.getBlocksForRange(
        userId,
        new Date("2026-04-16T00:00:00Z"),
        new Date("2026-04-17T00:00:00Z"),
      );

      expect(result).toEqual([mockBlock]);
      expect(schedulingRepo.getBlocksForRangeWithDetails).toHaveBeenCalledWith(
        userId,
        new Date("2026-04-16T00:00:00Z"),
        new Date("2026-04-17T00:00:00Z"),
      );
    });

    it("should return empty array when no blocks in range", async () => {
      schedulingRepo.getBlocksForRangeWithDetails.mockResolvedValue([]);

      const result = await service.getBlocksForRange(
        userId,
        new Date("2026-05-01T00:00:00Z"),
        new Date("2026-05-02T00:00:00Z"),
      );

      expect(result).toEqual([]);
    });

    it("should throw BadRequestException when start equals end", async () => {
      const sameDate = new Date("2026-04-16T00:00:00Z");

      await expect(
        service.getBlocksForRange(userId, sameDate, sameDate),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.getBlocksForRange(userId, sameDate, sameDate),
      ).rejects.toThrow("Start must be before end");
    });

    it("should throw BadRequestException when start is after end", async () => {
      await expect(
        service.getBlocksForRange(
          userId,
          new Date("2026-04-17T00:00:00Z"),
          new Date("2026-04-16T00:00:00Z"),
        ),
      ).rejects.toThrow("Start must be before end");
    });
  });

  // ── updateBlock ─────────────────────────────────────────

  describe("updateBlock", () => {
    const updated = { ...mockBlock, endTime: new Date("2026-04-16T11:00:00Z") };

    it("should patch times and return { block, conflicts }", async () => {
      schedulingRepo.findBlockById.mockResolvedValue(mockBlock as any);
      schedulingRepo.updateBlock.mockResolvedValue(updated as any);
      schedulingRepo.findOverlapping.mockResolvedValue([]);

      const result = await service.updateBlock(userId, 1, {
        endTime: new Date("2026-04-16T11:00:00Z"),
      });

      expect(result).toEqual({ block: updated, conflicts: [] });
      expect(schedulingRepo.updateBlock).toHaveBeenCalledWith(1, {
        endTime: new Date("2026-04-16T11:00:00Z"),
      });
    });

    it("should verify new task ownership when taskId changes", async () => {
      schedulingRepo.findBlockById.mockResolvedValue(mockBlock as any);
      tasksRepo.findById.mockResolvedValue({ ...mockTask, id: 99 } as any);
      schedulingRepo.updateBlock.mockResolvedValue({ ...updated, taskId: 99 } as any);
      schedulingRepo.findOverlapping.mockResolvedValue([]);

      await service.updateBlock(userId, 1, { taskId: 99 });

      expect(tasksRepo.findById).toHaveBeenCalledWith(99);
    });

    it("should throw NotFoundException when new task not owned", async () => {
      schedulingRepo.findBlockById.mockResolvedValue(mockBlock as any);
      tasksRepo.findById.mockResolvedValue({ ...mockTask, userId: otherUserId } as any);

      await expect(
        service.updateBlock(userId, 1, { taskId: 99 }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when effective start >= end", async () => {
      schedulingRepo.findBlockById.mockResolvedValue(mockBlock as any);

      await expect(
        service.updateBlock(userId, 1, {
          endTime: new Date("2026-04-16T08:00:00Z"),
        }),
      ).rejects.toThrow("Start time must be before end time");
    });

    it("should throw NotFoundException when block not owned", async () => {
      schedulingRepo.findBlockById.mockResolvedValue(mockBlock as any);

      await expect(
        service.updateBlock(otherUserId, 1, { status: "completed" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should exclude the block itself from overlap check", async () => {
      schedulingRepo.findBlockById.mockResolvedValue(mockBlock as any);
      schedulingRepo.updateBlock.mockResolvedValue(updated as any);
      schedulingRepo.findOverlapping.mockResolvedValue([]);

      await service.updateBlock(userId, 1, {
        endTime: new Date("2026-04-16T11:00:00Z"),
      });

      expect(schedulingRepo.findOverlapping).toHaveBeenCalledWith(
        userId,
        mockBlock.startTime,
        new Date("2026-04-16T11:00:00Z"),
        [1],
      );
    });

    it("should not check overlaps for status-only updates", async () => {
      schedulingRepo.findBlockById.mockResolvedValue(mockBlock as any);
      schedulingRepo.updateBlock.mockResolvedValue({
        ...mockBlock,
        status: "completed",
      } as any);

      const result = await service.updateBlock(userId, 1, {
        status: "completed",
      });

      expect(result.block.status).toBe("completed");
      expect(schedulingRepo.findOverlapping).not.toHaveBeenCalled();
      expect(schedulingRepo.updateBlock).toHaveBeenCalledWith(1, {
        status: "completed",
      });
    });

    it("should reject and not update when a time change overlaps another block", async () => {
      const conflicting = {
        id: 7,
        taskId: 11,
        taskTitle: "Run",
        startTime: new Date("2026-04-16T10:30:00Z"),
        endTime: new Date("2026-04-16T11:30:00Z"),
      };
      schedulingRepo.findBlockById.mockResolvedValue(mockBlock as any);
      schedulingRepo.findOverlapping.mockResolvedValue([conflicting] as any);

      let caught: unknown;
      try {
        await service.updateBlock(userId, 1, {
          endTime: new Date("2026-04-16T11:00:00Z"),
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      expect((caught as BadRequestException).getResponse()).toMatchObject({
        message: "Scheduled block conflicts with existing blocks",
        conflicts: [
          {
            inputIndex: 0,
            kind: "existing",
            blockId: 7,
            taskId: 11,
            taskTitle: "Run",
            startTime: conflicting.startTime.toISOString(),
            endTime: conflicting.endTime.toISOString(),
            attemptedBlockId: 1,
            attemptedTaskId: 10,
            attemptedStartTime: mockBlock.startTime.toISOString(),
            attemptedEndTime: new Date("2026-04-16T11:00:00Z").toISOString(),
          },
        ],
      });
      expect(schedulingRepo.updateBlock).not.toHaveBeenCalled();
      expect(tasksRepo.findById).not.toHaveBeenCalled();
    });
  });

  // ── shiftBlocks ─────────────────────────────────────────

  describe("shiftBlocks", () => {
    const block1 = { ...mockBlock, id: 1 };
    const block2 = {
      ...mockBlock,
      id: 2,
      startTime: new Date("2026-04-16T11:00:00Z"),
      endTime: new Date("2026-04-16T12:00:00Z"),
    };

    it("should shift explicit blockIds after ownership check", async () => {
      schedulingRepo.findBlockById.mockImplementation(async (id: number) =>
        id === 1 ? (block1 as any) : (block2 as any),
      );
      const shifted = [
        { ...block1, startTime: new Date("2026-04-16T09:30:00Z"), endTime: new Date("2026-04-16T10:30:00Z") },
        { ...block2, startTime: new Date("2026-04-16T11:30:00Z"), endTime: new Date("2026-04-16T12:30:00Z") },
      ];
      schedulingRepo.shiftBlocks.mockResolvedValue(shifted as any);
      schedulingRepo.findOverlapping.mockResolvedValue([]);

      const result = await service.shiftBlocks(userId, {
        blockIds: [1, 2],
        deltaMinutes: 30,
      });

      expect(schedulingRepo.shiftBlocks).toHaveBeenCalledWith([1, 2], 30);
      expect(result.blocks).toEqual(shifted);
      expect(result.conflicts).toEqual([]);
    });

    it("should resolve afterTime selector by querying blocks >= afterTime", async () => {
      schedulingRepo.getBlocksForRange.mockResolvedValue([block1, block2] as any);
      schedulingRepo.shiftBlocks.mockResolvedValue([block1, block2] as any);
      schedulingRepo.findOverlapping.mockResolvedValue([]);

      await service.shiftBlocks(userId, {
        afterTime: new Date("2026-04-16T08:00:00Z"),
        deltaMinutes: 15,
      });

      expect(schedulingRepo.shiftBlocks).toHaveBeenCalledWith([1, 2], 15);
    });

    it("should reject when both selectors provided", async () => {
      await expect(
        service.shiftBlocks(userId, {
          blockIds: [1],
          afterTime: new Date(),
          deltaMinutes: 10,
        } as any),
      ).rejects.toThrow("Provide exactly one of blockIds or afterTime");
    });

    it("should reject when neither selector provided", async () => {
      await expect(
        service.shiftBlocks(userId, { deltaMinutes: 10 } as any),
      ).rejects.toThrow("Provide exactly one of blockIds or afterTime");
    });

    it("should reject deltaMinutes of 0", async () => {
      await expect(
        service.shiftBlocks(userId, { blockIds: [1], deltaMinutes: 0 }),
      ).rejects.toThrow("deltaMinutes must be non-zero");
    });

    it("should throw when a blockId is not owned", async () => {
      schedulingRepo.findBlockById.mockImplementation(async (id: number) =>
        id === 1 ? (block1 as any) : null,
      );

      await expect(
        service.shiftBlocks(userId, { blockIds: [1, 999], deltaMinutes: 30 }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should exclude the shifted cohort from conflict detection", async () => {
      schedulingRepo.findBlockById.mockImplementation(async (id: number) =>
        id === 1 ? (block1 as any) : (block2 as any),
      );
      schedulingRepo.shiftBlocks.mockResolvedValue([block1, block2] as any);
      schedulingRepo.findOverlapping.mockResolvedValue([]);

      await service.shiftBlocks(userId, { blockIds: [1, 2], deltaMinutes: 30 });

      expect(schedulingRepo.findOverlapping).toHaveBeenCalledWith(
        userId,
        new Date("2026-04-16T09:30:00Z"),
        new Date("2026-04-16T12:30:00Z"),
        [1, 2],
      );
      expect(schedulingRepo.findOverlapping).toHaveBeenCalledTimes(1);
    });

    it("should reject and not shift when a shifted block overlaps an unshifted block", async () => {
      const conflicting = {
        id: 7,
        taskId: 11,
        taskTitle: "Run",
        startTime: new Date("2026-04-16T09:45:00Z"),
        endTime: new Date("2026-04-16T10:15:00Z"),
      };
      schedulingRepo.findBlockById.mockResolvedValue(block1 as any);
      schedulingRepo.findOverlapping.mockResolvedValue([conflicting] as any);

      let caught: unknown;
      try {
        await service.shiftBlocks(userId, {
          blockIds: [1],
          deltaMinutes: 30,
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      expect((caught as BadRequestException).getResponse()).toMatchObject({
        message: "Scheduled block conflicts with existing blocks",
        conflicts: [
          {
            inputIndex: 0,
            kind: "existing",
            blockId: 7,
            taskId: 11,
            taskTitle: "Run",
            startTime: conflicting.startTime.toISOString(),
            endTime: conflicting.endTime.toISOString(),
            attemptedBlockId: 1,
            attemptedTaskId: 10,
            attemptedStartTime: new Date("2026-04-16T09:30:00Z").toISOString(),
            attemptedEndTime: new Date("2026-04-16T10:30:00Z").toISOString(),
          },
        ],
      });
      expect(schedulingRepo.shiftBlocks).not.toHaveBeenCalled();
    });

    it("does not false-positive an unshifted block that falls in the shifted bounding gap", async () => {
      const lunchBlock = {
        id: 7,
        taskId: 33,
        taskTitle: "Lunch",
        startTime: new Date("2026-04-16T12:00:00Z"),
        endTime: new Date("2026-04-16T13:00:00Z"),
      };
      const afternoonBlock = {
        ...block2,
        id: 2,
        startTime: new Date("2026-04-16T14:00:00Z"),
        endTime: new Date("2026-04-16T15:00:00Z"),
      };
      const shifted = [
        {
          ...block1,
          startTime: new Date("2026-04-16T09:30:00Z"),
          endTime: new Date("2026-04-16T10:30:00Z"),
        },
        {
          ...afternoonBlock,
          startTime: new Date("2026-04-16T14:30:00Z"),
          endTime: new Date("2026-04-16T15:30:00Z"),
        },
      ];
      schedulingRepo.findBlockById.mockImplementation(async (id: number) =>
        id === 1 ? (block1 as any) : (afternoonBlock as any),
      );
      schedulingRepo.findOverlapping.mockResolvedValue([lunchBlock] as any);
      schedulingRepo.shiftBlocks.mockResolvedValue(shifted as any);

      const result = await service.shiftBlocks(userId, {
        blockIds: [1, 2],
        deltaMinutes: 30,
      });

      expect(result.conflicts).toEqual([]);
      expect(result.blocks).toEqual(shifted);
      expect(schedulingRepo.findOverlapping).toHaveBeenCalledWith(
        userId,
        new Date("2026-04-16T09:30:00Z"),
        new Date("2026-04-16T15:30:00Z"),
        [1, 2],
      );
      expect(schedulingRepo.findOverlapping).toHaveBeenCalledTimes(1);
      expect(schedulingRepo.shiftBlocks).toHaveBeenCalledWith([1, 2], 30);
    });
  });

  // ── deleteBlock ─────────────────────────────────────────

  describe("deleteBlock", () => {
    it("should delete and return the block", async () => {
      schedulingRepo.findBlockById.mockResolvedValue(mockBlock as any);
      schedulingRepo.deleteBlock.mockResolvedValue(mockBlock as any);

      const result = await service.deleteBlock(userId, 1);

      expect(result).toEqual(mockBlock);
      expect(schedulingRepo.deleteBlock).toHaveBeenCalledWith(1);
    });

    it("should throw NotFoundException when block does not exist", async () => {
      schedulingRepo.findBlockById.mockResolvedValue(null);

      await expect(service.deleteBlock(userId, 999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw NotFoundException when block belongs to another user", async () => {
      schedulingRepo.findBlockById.mockResolvedValue(mockBlock as any);

      await expect(service.deleteBlock(otherUserId, 1)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
