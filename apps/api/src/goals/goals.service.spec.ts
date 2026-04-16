import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";

jest.mock("../db", () => ({
  DRIZZLE: require("../db/types").DRIZZLE,
}));

import { GoalsService } from "./goals.service";
import { GoalsRepository } from "./goals.repository";
import { RealtimeGateway } from "../realtime/realtime.gateway";

describe("GoalsService", () => {
  let service: GoalsService;
  let goalsRepo: jest.Mocked<GoalsRepository>;

  const userId = "user-1";
  const otherUserId = "user-2";

  const mockGoal = {
    id: 1,
    userId,
    title: "Learn Rust",
    description: "Systems programming",
    context: null,
    color: "#7F77DD",
    status: "active" as const,
    targetDate: null,
    priority: 2,
    totalTasks: 5,
    completedTasks: 2,
    createdAt: new Date("2026-01-01"),
    completedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoalsService,
        {
          provide: GoalsRepository,
          useValue: {
            findByUserId: jest.fn(),
            findById: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            getProgress: jest.fn(),
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

    service = module.get<GoalsService>(GoalsService);
    goalsRepo = module.get(GoalsRepository);
  });

  // ── create ──────────────────────────────────────────────

  describe("create", () => {
    it("should create a goal with valid title", async () => {
      goalsRepo.create.mockResolvedValue(mockGoal as any);

      const result = await service.create(userId, {
        title: "Learn Rust",
        description: "Systems programming",
      });

      expect(result).toEqual(mockGoal);
      expect(goalsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Learn Rust",
          userId,
          description: "Systems programming",
        }),
      );
    });

    it("should trim whitespace from title", async () => {
      goalsRepo.create.mockResolvedValue(mockGoal as any);

      await service.create(userId, { title: "  Learn Rust  " });

      expect(goalsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Learn Rust" }),
      );
    });

    it("should throw BadRequestException for empty title", async () => {
      await expect(service.create(userId, { title: "" })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(userId, { title: "" })).rejects.toThrow(
        "Title is required",
      );
    });

    it("should throw BadRequestException for whitespace-only title", async () => {
      await expect(
        service.create(userId, { title: "   " }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── findAll ─────────────────────────────────────────────

  describe("findAll", () => {
    it("should return all goals for user with computed progress", async () => {
      const goals = [mockGoal];
      goalsRepo.findByUserId.mockResolvedValue(goals as any);

      const result = await service.findAll(userId);

      expect(result).toEqual([
        { ...mockGoal, progress: Math.round((mockGoal.completedTasks / mockGoal.totalTasks) * 100) },
      ]);
      expect(goalsRepo.findByUserId).toHaveBeenCalledWith(userId, undefined);
    });

    it("should pass status filter to repository", async () => {
      goalsRepo.findByUserId.mockResolvedValue([]);

      await service.findAll(userId, "active");

      expect(goalsRepo.findByUserId).toHaveBeenCalledWith(userId, "active");
    });

    it("should return empty array when user has no goals", async () => {
      goalsRepo.findByUserId.mockResolvedValue([]);

      const result = await service.findAll(userId);

      expect(result).toEqual([]);
    });
  });

  // ── findById ────────────────────────────────────────────

  describe("findById", () => {
    it("should return goal when it exists and user owns it", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);

      const result = await service.findById(userId, 1);

      expect(result).toEqual(mockGoal);
    });

    it("should throw NotFoundException when goal does not exist", async () => {
      goalsRepo.findById.mockResolvedValue(null);

      await expect(service.findById(userId, 999)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findById(userId, 999)).rejects.toThrow(
        "Goal not found",
      );
    });

    it("should throw NotFoundException when goal belongs to another user", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);

      await expect(service.findById(otherUserId, 1)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── update ──────────────────────────────────────────────

  describe("update", () => {
    beforeEach(() => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);
    });

    it("should update and return the goal", async () => {
      const updated = { ...mockGoal, title: "Master Rust" };
      goalsRepo.update.mockResolvedValue(updated as any);

      const result = await service.update(userId, 1, {
        title: "Master Rust",
      });

      expect(result).toEqual(updated);
      expect(goalsRepo.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ title: "Master Rust" }),
      );
    });

    it("should trim title on update", async () => {
      goalsRepo.update.mockResolvedValue(mockGoal as any);

      await service.update(userId, 1, { title: "  Trimmed  " });

      expect(goalsRepo.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ title: "Trimmed" }),
      );
    });

    it("should throw BadRequestException for empty title on update", async () => {
      await expect(
        service.update(userId, 1, { title: "" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for whitespace-only title on update", async () => {
      await expect(
        service.update(userId, 1, { title: "   " }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should set completedAt when status changes to completed", async () => {
      goalsRepo.update.mockResolvedValue(mockGoal as any);
      const before = Date.now();

      await service.update(userId, 1, { status: "completed" });

      const call = goalsRepo.update.mock.calls[0]![1] as any;
      expect(call.completedAt).toBeInstanceOf(Date);
      expect(call.completedAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it("should clear completedAt when status changes to active", async () => {
      goalsRepo.update.mockResolvedValue(mockGoal as any);

      await service.update(userId, 1, { status: "active" });

      expect(goalsRepo.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ completedAt: null }),
      );
    });

    it("should clear completedAt when status changes to paused", async () => {
      goalsRepo.update.mockResolvedValue(mockGoal as any);

      await service.update(userId, 1, { status: "paused" });

      expect(goalsRepo.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ completedAt: null }),
      );
    });

    it("should not set completedAt when status is not provided", async () => {
      goalsRepo.update.mockResolvedValue(mockGoal as any);

      await service.update(userId, 1, { description: "new desc" });

      const call = goalsRepo.update.mock.calls[0]![1] as any;
      expect(call).not.toHaveProperty("completedAt");
    });

    it("should allow update without title field", async () => {
      goalsRepo.update.mockResolvedValue(mockGoal as any);

      await service.update(userId, 1, { priority: 1 });

      expect(goalsRepo.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ priority: 1 }),
      );
    });

    it("should throw NotFoundException for non-existent goal", async () => {
      goalsRepo.findById.mockResolvedValue(null);

      await expect(
        service.update(userId, 999, { title: "Nope" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when goal belongs to another user", async () => {
      await expect(
        service.update(otherUserId, 1, { title: "Nope" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── delete ──────────────────────────────────────────────

  describe("delete", () => {
    it("should delete and return the goal", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);
      goalsRepo.delete.mockResolvedValue(mockGoal as any);

      const result = await service.delete(userId, 1);

      expect(result).toEqual(mockGoal);
      expect(goalsRepo.delete).toHaveBeenCalledWith(1);
    });

    it("should throw NotFoundException for non-existent goal", async () => {
      goalsRepo.findById.mockResolvedValue(null);

      await expect(service.delete(userId, 999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw NotFoundException when goal belongs to another user", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);

      await expect(service.delete(otherUserId, 1)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── getProgress ─────────────────────────────────────────

  describe("getProgress", () => {
    it("should return progress for owned goal", async () => {
      const progress = { total: 5, completed: 2, pct: 40 };
      goalsRepo.findById.mockResolvedValue(mockGoal as any);
      goalsRepo.getProgress.mockResolvedValue(progress);

      const result = await service.getProgress(userId, 1);

      expect(result).toEqual(progress);
      expect(goalsRepo.getProgress).toHaveBeenCalledWith(1);
    });

    it("should throw NotFoundException for non-existent goal", async () => {
      goalsRepo.findById.mockResolvedValue(null);

      await expect(service.getProgress(userId, 999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw NotFoundException when goal belongs to another user", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);

      await expect(service.getProgress(otherUserId, 1)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
