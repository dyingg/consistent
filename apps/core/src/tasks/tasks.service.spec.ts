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
import { DRIZZLE } from "../db/types";

jest.mock("../db", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory cannot reference outer-scope vars; require() is the documented escape
  DRIZZLE: require("../db/types").DRIZZLE,
}));

import { TasksService } from "./tasks.service";
import { TasksRepository } from "./tasks.repository";
import { DependenciesRepository } from "./dependencies.repository";
import { GoalsRepository } from "../goals/goals.repository";
import { RealtimeGateway } from "../realtime/realtime.gateway";

describe("TasksService", () => {
  let service: TasksService;
  let tasksRepo: jest.Mocked<TasksRepository>;
  let depsRepo: jest.Mocked<DependenciesRepository>;
  let goalsRepo: jest.Mocked<GoalsRepository>;
  let db: { transaction: jest.Mock };

  const userId = "user-1";
  const otherUserId = "user-2";

  const mockGoal = {
    id: 1,
    userId,
    title: "Learn Rust",
    status: "active",
    totalTasks: 5,
    completedTasks: 0,
    createdAt: new Date(),
  };

  const mockTask = {
    id: 10,
    goalId: 1,
    userId,
    title: "Read chapter 1",
    description: null,
    context: null,
    status: "pending" as const,
    estimatedMinutes: 60,
    actualMinutes: null,
    earliestStart: null,
    deadline: null,
    priority: 3,
    sprintPoints: null,
    contextTags: null,
    blockerCount: 0,
    completedAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };

  const mockDep = {
    taskId: 11,
    dependsOnId: 10,
    dependencyType: "finish_to_start" as const,
    lagMinutes: 0,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    db = {
      transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        {
          provide: TasksRepository,
          useValue: {
            findById: jest.fn(),
            findByGoalId: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            findReadyForUser: jest.fn(),
            getGoalDag: jest.fn(),
          },
        },
        {
          provide: DependenciesRepository,
          useValue: {
            create: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: GoalsRepository,
          useValue: {
            findById: jest.fn(),
          },
        },
        {
          provide: DRIZZLE,
          useValue: db,
        },
        {
          provide: RealtimeGateway,
          useValue: {
            broadcastToUser: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
    tasksRepo = module.get(TasksRepository);
    depsRepo = module.get(DependenciesRepository);
    goalsRepo = module.get(GoalsRepository);
  });

  // ── create ──────────────────────────────────────────────

  describe("create", () => {
    it("should create a task for an owned goal", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);
      tasksRepo.create.mockResolvedValue(mockTask as any);

      const result = await service.create(userId, 1, {
        title: "Read chapter 1",
        estimatedMinutes: 60,
      });

      expect(result).toEqual(mockTask);
      expect(tasksRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Read chapter 1",
          userId,
          goalId: 1,
        }),
      );
    });

    it("should trim title", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);
      tasksRepo.create.mockResolvedValue(mockTask as any);

      await service.create(userId, 1, { title: "  Trimmed  " });

      expect(tasksRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Trimmed" }),
      );
    });

    it("should throw BadRequestException for empty title", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);

      await expect(
        service.create(userId, 1, { title: "" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for whitespace-only title", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);

      await expect(
        service.create(userId, 1, { title: "   " }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw NotFoundException when goal does not exist", async () => {
      goalsRepo.findById.mockResolvedValue(null);

      await expect(
        service.create(userId, 999, { title: "Task" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when goal belongs to another user", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);

      await expect(
        service.create(otherUserId, 1, { title: "Task" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── bulkCreate ──────────────────────────────────────────

  describe("bulkCreate", () => {
    const mockInsertedTasks = [
      { ...mockTask, id: 100, title: "Task A" },
      { ...mockTask, id: 101, title: "Task B" },
      { ...mockTask, id: 102, title: "Task C" },
    ];

    const mockInsertedDeps = [
      { ...mockDep, taskId: 101, dependsOnId: 100 },
    ];

    function setupTransactionMock(
      insertedTasks: any[],
      insertedDeps: any[] = [],
    ) {
      db.transaction.mockImplementation(async (cb) => {
        const depInsertChain = {
          values: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue(insertedDeps),
        };
        const taskInsertChain = {
          values: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue(insertedTasks),
        };
        const tx = {
          insert: jest.fn()
            .mockReturnValueOnce(taskInsertChain)
            .mockReturnValueOnce(depInsertChain),
        };
        return cb(tx);
      });
    }

    it("should bulk create tasks without dependencies", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);
      setupTransactionMock(mockInsertedTasks);

      const result = await service.bulkCreate(userId, 1, {
        tasks: [
          { title: "Task A" },
          { title: "Task B" },
          { title: "Task C" },
        ],
      });

      expect(result.tasks).toEqual(mockInsertedTasks);
      expect(result.dependencies).toEqual([]);
    });

    it("should bulk create tasks with dependencies", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);
      setupTransactionMock(mockInsertedTasks, mockInsertedDeps);

      const result = await service.bulkCreate(userId, 1, {
        tasks: [
          { title: "Task A" },
          { title: "Task B" },
          { title: "Task C" },
        ],
        dependencies: [{ fromIndex: 1, toIndex: 0 }],
      });

      expect(result.tasks).toHaveLength(3);
      expect(result.dependencies).toHaveLength(1);
    });

    it("should map index-based deps to real IDs inside transaction", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);

      let capturedDepValues: any;
      db.transaction.mockImplementation(async (cb) => {
        const depInsertChain = {
          values: jest.fn().mockImplementation((v) => {
            capturedDepValues = v;
            return depInsertChain;
          }),
          returning: jest.fn().mockResolvedValue(mockInsertedDeps),
        };
        const taskInsertChain = {
          values: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue(mockInsertedTasks),
        };
        const tx = {
          insert: jest.fn()
            .mockReturnValueOnce(taskInsertChain)
            .mockReturnValueOnce(depInsertChain),
        };
        return cb(tx);
      });

      await service.bulkCreate(userId, 1, {
        tasks: [{ title: "A" }, { title: "B" }],
        dependencies: [
          { fromIndex: 1, toIndex: 0, type: "start_to_start", lagMinutes: 5 },
        ],
      });

      expect(capturedDepValues).toEqual([
        {
          taskId: 101,      // mockInsertedTasks[1].id
          dependsOnId: 100, // mockInsertedTasks[0].id
          dependencyType: "start_to_start",
          lagMinutes: 5,
        },
      ]);
    });

    it("should throw BadRequestException for empty tasks array", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);

      await expect(
        service.bulkCreate(userId, 1, { tasks: [] }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.bulkCreate(userId, 1, { tasks: [] }),
      ).rejects.toThrow("At least one task is required");
    });

    it("should throw BadRequestException when a task has empty title", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);

      await expect(
        service.bulkCreate(userId, 1, {
          tasks: [{ title: "Good" }, { title: "" }],
        }),
      ).rejects.toThrow("All tasks must have a title");
    });

    it("should throw BadRequestException when a task has whitespace-only title", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);

      await expect(
        service.bulkCreate(userId, 1, {
          tasks: [{ title: "Good" }, { title: "   " }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for out-of-bounds fromIndex", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);

      await expect(
        service.bulkCreate(userId, 1, {
          tasks: [{ title: "A" }, { title: "B" }],
          dependencies: [{ fromIndex: 5, toIndex: 0 }],
        }),
      ).rejects.toThrow("Invalid fromIndex: 5");
    });

    it("should throw BadRequestException for negative fromIndex", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);

      await expect(
        service.bulkCreate(userId, 1, {
          tasks: [{ title: "A" }],
          dependencies: [{ fromIndex: -1, toIndex: 0 }],
        }),
      ).rejects.toThrow("Invalid fromIndex: -1");
    });

    it("should throw BadRequestException for out-of-bounds toIndex", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);

      await expect(
        service.bulkCreate(userId, 1, {
          tasks: [{ title: "A" }, { title: "B" }],
          dependencies: [{ fromIndex: 0, toIndex: 10 }],
        }),
      ).rejects.toThrow("Invalid toIndex: 10");
    });

    it("should throw BadRequestException for self-dependency", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);

      await expect(
        service.bulkCreate(userId, 1, {
          tasks: [{ title: "A" }, { title: "B" }],
          dependencies: [{ fromIndex: 0, toIndex: 0 }],
        }),
      ).rejects.toThrow("A task cannot depend on itself");
    });

    it("should throw NotFoundException when goal does not exist", async () => {
      goalsRepo.findById.mockResolvedValue(null);

      await expect(
        service.bulkCreate(userId, 999, {
          tasks: [{ title: "A" }],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when goal belongs to another user", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);

      await expect(
        service.bulkCreate(otherUserId, 1, {
          tasks: [{ title: "A" }],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should catch cycle detection error and throw BadRequestException", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);

      db.transaction.mockImplementation(async (cb) => {
        const depInsertChain = {
          values: jest.fn().mockReturnThis(),
          returning: jest.fn().mockRejectedValue({
            code: "23514",
            message: "cycle detected",
          }),
        };
        const taskInsertChain = {
          values: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue(mockInsertedTasks),
        };
        const tx = {
          insert: jest.fn()
            .mockReturnValueOnce(taskInsertChain)
            .mockReturnValueOnce(depInsertChain),
        };
        return cb(tx);
      });

      await expect(
        service.bulkCreate(userId, 1, {
          tasks: [{ title: "A" }, { title: "B" }, { title: "C" }],
          dependencies: [
            { fromIndex: 1, toIndex: 0 },
            { fromIndex: 0, toIndex: 1 },
          ],
        }),
      ).rejects.toThrow("Dependency edges would create a circular dependency");
    });

    it("should re-throw non-cycle errors from transaction", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);

      db.transaction.mockImplementation(async (cb) => {
        const depInsertChain = {
          values: jest.fn().mockReturnThis(),
          returning: jest.fn().mockRejectedValue(
            new Error("Connection lost"),
          ),
        };
        const taskInsertChain = {
          values: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue(mockInsertedTasks),
        };
        const tx = {
          insert: jest.fn()
            .mockReturnValueOnce(taskInsertChain)
            .mockReturnValueOnce(depInsertChain),
        };
        return cb(tx);
      });

      await expect(
        service.bulkCreate(userId, 1, {
          tasks: [{ title: "A" }, { title: "B" }],
          dependencies: [{ fromIndex: 1, toIndex: 0 }],
        }),
      ).rejects.toThrow("Connection lost");
    });

    it("should default dependency type to finish_to_start", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);

      let capturedDepValues: any;
      db.transaction.mockImplementation(async (cb) => {
        const depInsertChain = {
          values: jest.fn().mockImplementation((v) => {
            capturedDepValues = v;
            return depInsertChain;
          }),
          returning: jest.fn().mockResolvedValue(mockInsertedDeps),
        };
        const taskInsertChain = {
          values: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue(mockInsertedTasks),
        };
        const tx = {
          insert: jest.fn()
            .mockReturnValueOnce(taskInsertChain)
            .mockReturnValueOnce(depInsertChain),
        };
        return cb(tx);
      });

      await service.bulkCreate(userId, 1, {
        tasks: [{ title: "A" }, { title: "B" }],
        dependencies: [{ fromIndex: 1, toIndex: 0 }],
      });

      expect(capturedDepValues[0].dependencyType).toBe("finish_to_start");
      expect(capturedDepValues[0].lagMinutes).toBe(0);
    });
  });

  // ── findAllForGoal ──────────────────────────────────────

  describe("findAllForGoal", () => {
    it("should return tasks for an owned goal", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);
      tasksRepo.findByGoalId.mockResolvedValue([mockTask] as any);

      const result = await service.findAllForGoal(userId, 1);

      expect(result).toEqual([mockTask]);
    });

    it("should return empty array when goal has no tasks", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);
      tasksRepo.findByGoalId.mockResolvedValue([]);

      const result = await service.findAllForGoal(userId, 1);

      expect(result).toEqual([]);
    });

    it("should throw NotFoundException when goal does not exist", async () => {
      goalsRepo.findById.mockResolvedValue(null);

      await expect(
        service.findAllForGoal(userId, 999),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when goal belongs to another user", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);

      await expect(
        service.findAllForGoal(otherUserId, 1),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── findById ────────────────────────────────────────────

  describe("findById", () => {
    it("should return task when it exists and user owns it", async () => {
      tasksRepo.findById.mockResolvedValue(mockTask as any);

      const result = await service.findById(userId, 10);

      expect(result).toEqual(mockTask);
    });

    it("should throw NotFoundException when task does not exist", async () => {
      tasksRepo.findById.mockResolvedValue(null);

      await expect(service.findById(userId, 999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw NotFoundException when task belongs to another user", async () => {
      tasksRepo.findById.mockResolvedValue(mockTask as any);

      await expect(service.findById(otherUserId, 10)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── update ──────────────────────────────────────────────

  describe("update", () => {
    beforeEach(() => {
      tasksRepo.findById.mockResolvedValue(mockTask as any);
    });

    it("should update and return the task", async () => {
      const updated = { ...mockTask, title: "Updated" };
      tasksRepo.update.mockResolvedValue(updated as any);

      const result = await service.update(userId, 10, { title: "Updated" });

      expect(result).toEqual(updated);
    });

    it("should trim title on update", async () => {
      tasksRepo.update.mockResolvedValue(mockTask as any);

      await service.update(userId, 10, { title: "  Trimmed  " });

      expect(tasksRepo.update).toHaveBeenCalledWith(
        10,
        expect.objectContaining({ title: "Trimmed" }),
      );
    });

    it("should throw BadRequestException for empty title on update", async () => {
      await expect(
        service.update(userId, 10, { title: "" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for whitespace-only title on update", async () => {
      await expect(
        service.update(userId, 10, { title: "   " }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should set completedAt when status changes to completed", async () => {
      tasksRepo.update.mockResolvedValue(mockTask as any);
      const before = Date.now();

      await service.update(userId, 10, { status: "completed" });

      const call = tasksRepo.update.mock.calls[0]![1] as any;
      expect(call.completedAt).toBeInstanceOf(Date);
      expect(call.completedAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it("should clear completedAt when status changes to pending", async () => {
      tasksRepo.update.mockResolvedValue(mockTask as any);

      await service.update(userId, 10, { status: "pending" });

      expect(tasksRepo.update).toHaveBeenCalledWith(
        10,
        expect.objectContaining({ completedAt: null }),
      );
    });

    it("should clear completedAt when status changes to in_progress", async () => {
      tasksRepo.update.mockResolvedValue(mockTask as any);

      await service.update(userId, 10, { status: "in_progress" });

      expect(tasksRepo.update).toHaveBeenCalledWith(
        10,
        expect.objectContaining({ completedAt: null }),
      );
    });

    it("should not set completedAt when status is not provided", async () => {
      tasksRepo.update.mockResolvedValue(mockTask as any);

      await service.update(userId, 10, { description: "new desc" });

      const call = tasksRepo.update.mock.calls[0]![1] as any;
      expect(call).not.toHaveProperty("completedAt");
    });

    it("should throw NotFoundException for non-existent task", async () => {
      tasksRepo.findById.mockResolvedValue(null);

      await expect(
        service.update(userId, 999, { title: "Nope" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when task belongs to another user", async () => {
      await expect(
        service.update(otherUserId, 10, { title: "Nope" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── delete ──────────────────────────────────────────────

  describe("delete", () => {
    it("should delete and return the task", async () => {
      tasksRepo.findById.mockResolvedValue(mockTask as any);
      tasksRepo.delete.mockResolvedValue(mockTask as any);

      const result = await service.delete(userId, 10);

      expect(result).toEqual(mockTask);
      expect(tasksRepo.delete).toHaveBeenCalledWith(10);
    });

    it("should throw NotFoundException for non-existent task", async () => {
      tasksRepo.findById.mockResolvedValue(null);

      await expect(service.delete(userId, 999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw NotFoundException when task belongs to another user", async () => {
      tasksRepo.findById.mockResolvedValue(mockTask as any);

      await expect(service.delete(otherUserId, 10)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── findReadyForUser ────────────────────────────────────

  describe("findReadyForUser", () => {
    it("should return ready tasks for user", async () => {
      tasksRepo.findReadyForUser.mockResolvedValue([mockTask] as any);

      const result = await service.findReadyForUser(userId);

      expect(result).toEqual([mockTask]);
      expect(tasksRepo.findReadyForUser).toHaveBeenCalledWith(userId);
    });

    it("should return empty array when no tasks are ready", async () => {
      tasksRepo.findReadyForUser.mockResolvedValue([]);

      const result = await service.findReadyForUser(userId);

      expect(result).toEqual([]);
    });
  });

  // ── getGoalDag ──────────────────────────────────────────

  describe("getGoalDag", () => {
    it("should return DAG for owned goal", async () => {
      const dagResult = { rows: [mockTask] };
      goalsRepo.findById.mockResolvedValue(mockGoal as any);
      tasksRepo.getGoalDag.mockResolvedValue(dagResult as any);

      const result = await service.getGoalDag(userId, 1);

      expect(result).toEqual(dagResult);
      expect(tasksRepo.getGoalDag).toHaveBeenCalledWith(1);
    });

    it("should throw NotFoundException when goal does not exist", async () => {
      goalsRepo.findById.mockResolvedValue(null);

      await expect(service.getGoalDag(userId, 999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw NotFoundException when goal belongs to another user", async () => {
      goalsRepo.findById.mockResolvedValue(mockGoal as any);

      await expect(service.getGoalDag(otherUserId, 1)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── addDependency ───────────────────────────────────────

  describe("addDependency", () => {
    const taskA = { ...mockTask, id: 10, goalId: 1 };
    const taskB = { ...mockTask, id: 11, goalId: 1 };

    it("should create dependency between tasks in the same goal", async () => {
      tasksRepo.findById
        .mockResolvedValueOnce(taskA as any)
        .mockResolvedValueOnce(taskB as any);
      depsRepo.create.mockResolvedValue(mockDep as any);

      const result = await service.addDependency(userId, 10, 11);

      expect(result).toEqual(mockDep);
      expect(depsRepo.create).toHaveBeenCalledWith({
        taskId: 10,
        dependsOnId: 11,
        dependencyType: "finish_to_start",
        lagMinutes: 0,
      });
    });

    it("should pass custom type and lagMinutes", async () => {
      tasksRepo.findById
        .mockResolvedValueOnce(taskA as any)
        .mockResolvedValueOnce(taskB as any);
      depsRepo.create.mockResolvedValue(mockDep as any);

      await service.addDependency(userId, 10, 11, "start_to_start", 15);

      expect(depsRepo.create).toHaveBeenCalledWith({
        taskId: 10,
        dependsOnId: 11,
        dependencyType: "start_to_start",
        lagMinutes: 15,
      });
    });

    it("should throw BadRequestException when tasks belong to different goals", async () => {
      const taskDifferentGoal = { ...mockTask, id: 11, goalId: 2 };
      tasksRepo.findById
        .mockResolvedValueOnce(taskA as any)
        .mockResolvedValueOnce(taskDifferentGoal as any);

      await expect(
        service.addDependency(userId, 10, 11),
      ).rejects.toThrow("Tasks must belong to the same goal");
    });

    it("should throw NotFoundException when first task does not exist", async () => {
      tasksRepo.findById.mockResolvedValueOnce(null);

      await expect(
        service.addDependency(userId, 999, 11),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when second task does not exist", async () => {
      tasksRepo.findById
        .mockResolvedValueOnce(taskA as any)
        .mockResolvedValueOnce(null);

      await expect(
        service.addDependency(userId, 10, 999),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when first task belongs to another user", async () => {
      await expect(
        service.addDependency(otherUserId, 10, 11),
      ).rejects.toThrow(NotFoundException);
    });

    it("should propagate cycle detection from DependenciesRepository", async () => {
      tasksRepo.findById
        .mockResolvedValueOnce(taskA as any)
        .mockResolvedValueOnce(taskB as any);
      depsRepo.create.mockRejectedValue(
        new BadRequestException(
          "Adding this dependency would create a circular dependency",
        ),
      );

      await expect(
        service.addDependency(userId, 10, 11),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── removeDependency ────────────────────────────────────

  describe("removeDependency", () => {
    it("should remove and return the dependency", async () => {
      tasksRepo.findById.mockResolvedValue(mockTask as any);
      depsRepo.delete.mockResolvedValue(mockDep as any);

      const result = await service.removeDependency(userId, 10, 11);

      expect(result).toEqual(mockDep);
      expect(depsRepo.delete).toHaveBeenCalledWith(10, 11);
    });

    it("should throw NotFoundException when dependency does not exist", async () => {
      tasksRepo.findById.mockResolvedValue(mockTask as any);
      depsRepo.delete.mockResolvedValue(null);

      await expect(
        service.removeDependency(userId, 10, 99),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.removeDependency(userId, 10, 99),
      ).rejects.toThrow("Dependency not found");
    });

    it("should throw NotFoundException when task does not exist", async () => {
      tasksRepo.findById.mockResolvedValue(null);

      await expect(
        service.removeDependency(userId, 999, 11),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when task belongs to another user", async () => {
      tasksRepo.findById.mockResolvedValue(mockTask as any);

      await expect(
        service.removeDependency(otherUserId, 10, 11),
      ).rejects.toThrow(NotFoundException);
    });
  });
});