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
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

jest.mock("../db", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory cannot reference outer-scope vars; require() is the documented escape
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
            findInboxByUserId: jest.fn(),
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

    it.each(["Inbox", "inbox", "INBOX", "  Inbox  "])(
      "should reject the reserved title %p",
      async (title) => {
        await expect(service.create(userId, { title })).rejects.toThrow(
          BadRequestException,
        );
        await expect(service.create(userId, { title })).rejects.toThrow(
          /reserved title/,
        );
        expect(goalsRepo.create).not.toHaveBeenCalled();
      },
    );

    it("should allow titles that merely contain 'inbox'", async () => {
      goalsRepo.create.mockResolvedValue(mockGoal as any);
      await service.create(userId, { title: "My Inbox Cleanup" });
      expect(goalsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: "My Inbox Cleanup" }),
      );
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

    it("should reject renaming a non-inbox goal to 'Inbox'", async () => {
      await expect(
        service.update(userId, 1, { title: "Inbox" }),
      ).rejects.toThrow(/reserved title/);
      expect(goalsRepo.update).not.toHaveBeenCalled();
    });

    it("should allow renaming the Inbox back to 'Inbox'", async () => {
      const inbox = { ...mockGoal, isInbox: true, title: "Quick tasks" };
      goalsRepo.findById.mockResolvedValue(inbox as any);
      goalsRepo.update.mockResolvedValue({ ...inbox, title: "Inbox" } as any);

      await service.update(userId, 1, { title: "Inbox" });

      expect(goalsRepo.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ title: "Inbox" }),
      );
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

    it("should throw ForbiddenException when deleting the Inbox goal", async () => {
      const inbox = { ...mockGoal, isInbox: true };
      goalsRepo.findById.mockResolvedValue(inbox as any);

      await expect(service.delete(userId, 1)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.delete(userId, 1)).rejects.toThrow(
        "The Inbox goal cannot be deleted",
      );
      expect(goalsRepo.delete).not.toHaveBeenCalled();
    });
  });

  // ── findInboxId ─────────────────────────────────────────

  describe("findInboxId", () => {
    it("should return the user's Inbox goal id", async () => {
      const inbox = { ...mockGoal, id: 42, isInbox: true };
      goalsRepo.findInboxByUserId.mockResolvedValue(inbox as any);

      const result = await service.findInboxId(userId);

      expect(result).toBe(42);
      expect(goalsRepo.findInboxByUserId).toHaveBeenCalledWith(userId);
      expect(goalsRepo.create).not.toHaveBeenCalled();
    });

    it("should self-heal by creating an Inbox when the user has none", async () => {
      const created = { ...mockGoal, id: 99, isInbox: true, title: "Inbox" };
      goalsRepo.findInboxByUserId.mockResolvedValue(null);
      goalsRepo.create.mockResolvedValue(created as any);

      const result = await service.findInboxId(userId);

      expect(result).toBe(99);
      expect(goalsRepo.create).toHaveBeenCalledWith({
        userId,
        title: "Inbox",
        isInbox: true,
      });
    });

    it("should recover when a concurrent insert wins the race", async () => {
      const winner = { ...mockGoal, id: 100, isInbox: true, title: "Inbox" };
      goalsRepo.findInboxByUserId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(winner as any);
      goalsRepo.create.mockRejectedValue(
        new Error("unique constraint violation"),
      );

      const result = await service.findInboxId(userId);

      expect(result).toBe(100);
      expect(goalsRepo.findInboxByUserId).toHaveBeenCalledTimes(2);
    });

    it("should throw NotFoundException when create fails and re-read returns null", async () => {
      goalsRepo.findInboxByUserId.mockResolvedValue(null);
      goalsRepo.create.mockRejectedValue(new Error("db down"));

      await expect(service.findInboxId(userId)).rejects.toThrow(
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