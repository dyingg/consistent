import { Test, TestingModule } from "@nestjs/testing";
import { DRIZZLE } from "../db/types";

jest.mock("../db", () => ({
  DRIZZLE: require("../db/types").DRIZZLE,
}));

import { GoalsRepository } from "./goals.repository";

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

describe("GoalsRepository", () => {
  let repo: GoalsRepository;
  let db: Record<string, jest.Mock>;

  const mockGoal = {
    id: 1,
    userId: "user-1",
    title: "Learn TypeScript",
    description: "Complete TS course",
    status: "active",
    totalTasks: 10,
    completedTasks: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    db = {
      select: jest.fn(),
      insert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoalsRepository,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();

    repo = module.get<GoalsRepository>(GoalsRepository);
  });

  describe("findByUserId", () => {
    it("should return array of goals for a user", async () => {
      const goals = [mockGoal, { ...mockGoal, id: 2, title: "Learn Rust" }];
      const chain = chainMock(goals, ["from", "where"]);
      db.select.mockReturnValue(chain);

      const result = await repo.findByUserId("user-1");

      expect(result).toEqual(goals);
      expect(db.select).toHaveBeenCalled();
      expect(chain.from).toHaveBeenCalled();
      expect(chain.where).toHaveBeenCalled();
    });
  });

  describe("findById", () => {
    it("should return goal when found", async () => {
      const chain = chainMock([mockGoal], ["from", "where", "limit"]);
      db.select.mockReturnValue(chain);

      const result = await repo.findById(1);

      expect(result).toEqual(mockGoal);
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
    it("should insert goal and return it", async () => {
      const chain = chainMock([mockGoal], ["values", "returning"]);
      db.insert.mockReturnValue(chain);

      const result = await repo.create({
        userId: "user-1",
        title: "Learn TypeScript",
        description: "Complete TS course",
      } as any);

      expect(result).toEqual(mockGoal);
      expect(db.insert).toHaveBeenCalled();
      expect(chain.values).toHaveBeenCalled();
      expect(chain.returning).toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("should update goal fields and return updated goal", async () => {
      const updatedGoal = { ...mockGoal, title: "Master TypeScript" };
      const chain = chainMock([updatedGoal], ["set", "where", "returning"]);
      db.update.mockReturnValue(chain);

      const result = await repo.update(1, { title: "Master TypeScript" } as any);

      expect(result).toEqual(updatedGoal);
      expect(db.update).toHaveBeenCalled();
      expect(chain.set).toHaveBeenCalled();
      expect(chain.where).toHaveBeenCalled();
      expect(chain.returning).toHaveBeenCalled();
    });

    it("should return null when goal not found", async () => {
      const chain = chainMock([], ["set", "where", "returning"]);
      db.update.mockReturnValue(chain);

      const result = await repo.update(999, { title: "Nope" } as any);

      expect(result).toBeNull();
    });
  });

  describe("delete", () => {
    it("should delete goal and return it", async () => {
      const chain = chainMock([mockGoal], ["where", "returning"]);
      db.delete.mockReturnValue(chain);

      const result = await repo.delete(1);

      expect(result).toEqual(mockGoal);
      expect(db.delete).toHaveBeenCalled();
      expect(chain.where).toHaveBeenCalled();
      expect(chain.returning).toHaveBeenCalled();
    });

    it("should return null when goal not found", async () => {
      const chain = chainMock([], ["where", "returning"]);
      db.delete.mockReturnValue(chain);

      const result = await repo.delete(999);

      expect(result).toBeNull();
    });
  });

  describe("getProgress", () => {
    it("should return { total, completed, pct } from denormalized columns", async () => {
      const chain = chainMock([mockGoal], ["from", "where", "limit"]);
      db.select.mockReturnValue(chain);

      const result = await repo.getProgress(1);

      expect(result).toEqual({
        total: 10,
        completed: 3,
        pct: 30,
      });
    });

    it("should return pct=0 when totalTasks is 0", async () => {
      const zeroGoal = { ...mockGoal, totalTasks: 0, completedTasks: 0 };
      const chain = chainMock([zeroGoal], ["from", "where", "limit"]);
      db.select.mockReturnValue(chain);

      const result = await repo.getProgress(1);

      expect(result).toEqual({
        total: 0,
        completed: 0,
        pct: 0,
      });
    });

    it("should return null when goal not found", async () => {
      const chain = chainMock([], ["from", "where", "limit"]);
      db.select.mockReturnValue(chain);

      const result = await repo.getProgress(999);

      expect(result).toBeNull();
    });
  });
});
