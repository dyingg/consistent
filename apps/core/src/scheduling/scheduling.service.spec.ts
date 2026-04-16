import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";

jest.mock("../db", () => ({
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
            updateBlockStatus: jest.fn(),
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

      const result = await service.createBlock(userId, {
        taskId: 10,
        startTime: new Date("2026-04-16T09:00:00Z"),
        endTime: new Date("2026-04-16T10:00:00Z"),
        scheduledBy: "user",
      });

      expect(result).toEqual(mockBlock);
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

  // ── updateBlockStatus ───────────────────────────────────

  describe("updateBlockStatus", () => {
    it("should update status of an owned block", async () => {
      const updatedBlock = { ...mockBlock, status: "confirmed" as const };
      schedulingRepo.findBlockById.mockResolvedValue(mockBlock as any);
      schedulingRepo.updateBlockStatus.mockResolvedValue(updatedBlock as any);

      const result = await service.updateBlockStatus(
        userId,
        1,
        "confirmed",
      );

      expect(result).toEqual(updatedBlock);
      expect(schedulingRepo.updateBlockStatus).toHaveBeenCalledWith(
        1,
        "confirmed",
      );
    });

    it("should allow updating to completed status", async () => {
      schedulingRepo.findBlockById.mockResolvedValue(mockBlock as any);
      schedulingRepo.updateBlockStatus.mockResolvedValue({
        ...mockBlock,
        status: "completed",
      } as any);

      const result = await service.updateBlockStatus(
        userId,
        1,
        "completed",
      );

      expect(result.status).toBe("completed");
    });

    it("should allow updating to missed status", async () => {
      schedulingRepo.findBlockById.mockResolvedValue(mockBlock as any);
      schedulingRepo.updateBlockStatus.mockResolvedValue({
        ...mockBlock,
        status: "missed",
      } as any);

      const result = await service.updateBlockStatus(userId, 1, "missed");

      expect(result.status).toBe("missed");
    });

    it("should allow updating to moved status", async () => {
      schedulingRepo.findBlockById.mockResolvedValue(mockBlock as any);
      schedulingRepo.updateBlockStatus.mockResolvedValue({
        ...mockBlock,
        status: "moved",
      } as any);

      const result = await service.updateBlockStatus(userId, 1, "moved");

      expect(result.status).toBe("moved");
    });

    it("should throw NotFoundException when block does not exist", async () => {
      schedulingRepo.findBlockById.mockResolvedValue(null);

      await expect(
        service.updateBlockStatus(userId, 999, "confirmed"),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.updateBlockStatus(userId, 999, "confirmed"),
      ).rejects.toThrow("Scheduled block not found");
    });

    it("should throw NotFoundException when block belongs to another user", async () => {
      schedulingRepo.findBlockById.mockResolvedValue(mockBlock as any);

      await expect(
        service.updateBlockStatus(otherUserId, 1, "confirmed"),
      ).rejects.toThrow(NotFoundException);
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
