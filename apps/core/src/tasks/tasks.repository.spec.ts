import { Test, TestingModule } from "@nestjs/testing";
import { DRIZZLE } from "../db/types";

jest.mock("../db", () => ({
  DRIZZLE: require("../db/types").DRIZZLE,
}));

import { TasksRepository } from "./tasks.repository";

function chainMock(result: unknown, methods: string[]) {
  const chain: Record<string, jest.Mock> = {};
  for (let i = methods.length - 1; i >= 0; i--) {
    const method = methods[i]!;
    chain[method] = jest.fn().mockReturnValue(
      i === methods.length - 1 ? Promise.resolve(result) : chain,
    );
  }
  return chain;
}

describe("TasksRepository", () => {
  let repo: TasksRepository;
  let db: Record<string, jest.Mock>;

  const mockTask = {
    id: 1,
    goalId: 10,
    userId: "user-1",
    title: "Write tests",
    description: "Write unit tests for repo",
    status: "pending",
    blockerCount: 0,
    estimateMinutes: 60,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    db = {
      select: jest.fn(),
      insert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      execute: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksRepository,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();

    repo = module.get<TasksRepository>(TasksRepository);
  });

  describe("findByGoalId", () => {
    it("should return tasks for a goal", async () => {
      const tasks = [mockTask, { ...mockTask, id: 2, title: "Review tests" }];
      const chain = chainMock(tasks, ["from", "where"]);
      db.select.mockReturnValue(chain);

      const result = await repo.findByGoalId(10);

      expect(result).toEqual(tasks);
      expect(db.select).toHaveBeenCalled();
      expect(chain.from).toHaveBeenCalled();
      expect(chain.where).toHaveBeenCalled();
    });
  });

  describe("findById", () => {
    it("should return task when found", async () => {
      const chain = chainMock([mockTask], ["from", "where", "limit"]);
      db.select.mockReturnValue(chain);

      const result = await repo.findById(1);

      expect(result).toEqual(mockTask);
      expect(chain.limit).toHaveBeenCalledWith(1);
    });

    it("should return null when not found", async () => {
      const chain = chainMock([], ["from", "where", "limit"]);
      db.select.mockReturnValue(chain);

      const result = await repo.findById(999);

      expect(result).toBeNull();
    });
  });

  describe("create", () => {
    it("should insert task and return it", async () => {
      const chain = chainMock([mockTask], ["values", "returning"]);
      db.insert.mockReturnValue(chain);

      const result = await repo.create({
        goalId: 10,
        userId: "user-1",
        title: "Write tests",
      } as any);

      expect(result).toEqual(mockTask);
      expect(db.insert).toHaveBeenCalled();
      expect(chain.values).toHaveBeenCalled();
      expect(chain.returning).toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("should update task fields and return updated task", async () => {
      const updatedTask = { ...mockTask, title: "Write better tests" };
      const chain = chainMock([updatedTask], ["set", "where", "returning"]);
      db.update.mockReturnValue(chain);

      const result = await repo.update(1, { title: "Write better tests" } as any);

      expect(result).toEqual(updatedTask);
      expect(db.update).toHaveBeenCalled();
      expect(chain.set).toHaveBeenCalled();
      expect(chain.where).toHaveBeenCalled();
      expect(chain.returning).toHaveBeenCalled();
    });

    it("should return null when task not found", async () => {
      const chain = chainMock([], ["set", "where", "returning"]);
      db.update.mockReturnValue(chain);

      const result = await repo.update(999, { title: "Nope" } as any);

      expect(result).toBeNull();
    });
  });

  describe("delete", () => {
    it("should delete task and return it", async () => {
      const chain = chainMock([mockTask], ["where", "returning"]);
      db.delete.mockReturnValue(chain);

      const result = await repo.delete(1);

      expect(result).toEqual(mockTask);
      expect(db.delete).toHaveBeenCalled();
      expect(chain.where).toHaveBeenCalled();
      expect(chain.returning).toHaveBeenCalled();
    });

    it("should return null when task not found", async () => {
      const chain = chainMock([], ["where", "returning"]);
      db.delete.mockReturnValue(chain);

      const result = await repo.delete(999);

      expect(result).toBeNull();
    });
  });

  describe("findReadyForUser", () => {
    it("should query with userId, blockerCount=0, status=pending", async () => {
      const readyTasks = [mockTask];
      const chain = chainMock(readyTasks, ["from", "where"]);
      db.select.mockReturnValue(chain);

      const result = await repo.findReadyForUser("user-1");

      expect(result).toEqual(readyTasks);
      expect(db.select).toHaveBeenCalled();
      expect(chain.from).toHaveBeenCalled();
      expect(chain.where).toHaveBeenCalled();
    });
  });

  describe("getGoalDag", () => {
    it("should call db.execute with recursive CTE SQL", async () => {
      const dagResult = [
        { ...mockTask, depth: 0 },
        { ...mockTask, id: 2, title: "Task 2", depth: 1 },
      ];
      db.execute.mockResolvedValue(dagResult);

      const result = await repo.getGoalDag(10);

      expect(result).toEqual(dagResult);
      expect(db.execute).toHaveBeenCalled();
    });
  });
});
