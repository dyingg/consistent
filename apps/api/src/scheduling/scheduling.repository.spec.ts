import { Test, TestingModule } from "@nestjs/testing";
import { DRIZZLE } from "../db/types";

jest.mock("../db", () => ({
  DRIZZLE: require("../db/types").DRIZZLE,
}));

import { SchedulingRepository } from "./scheduling.repository";

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

describe("SchedulingRepository", () => {
  let repo: SchedulingRepository;
  let db: Record<string, jest.Mock>;

  const mockRun = {
    id: 1,
    userId: "user-1",
    ranAt: new Date(),
    createdAt: new Date(),
  };

  const mockBlock = {
    id: 1,
    userId: "user-1",
    taskId: 10,
    runId: 1,
    startTime: new Date("2026-04-16T09:00:00Z"),
    endTime: new Date("2026-04-16T10:00:00Z"),
    status: "planned",
    scheduledBy: "auto",
    createdAt: new Date(),
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
        SchedulingRepository,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();

    repo = module.get<SchedulingRepository>(SchedulingRepository);
  });

  describe("createRun", () => {
    it("should insert schedule run and return it", async () => {
      const chain = chainMock([mockRun], ["values", "returning"]);
      db.insert.mockReturnValue(chain);

      const result = await repo.createRun({
        userId: "user-1",
      } as any);

      expect(result).toEqual(mockRun);
      expect(db.insert).toHaveBeenCalled();
      expect(chain.values).toHaveBeenCalled();
      expect(chain.returning).toHaveBeenCalled();
    });
  });

  describe("createBlock", () => {
    it("should insert scheduled block and return it", async () => {
      const chain = chainMock([mockBlock], ["values", "returning"]);
      db.insert.mockReturnValue(chain);

      const result = await repo.createBlock({
        userId: "user-1",
        taskId: 10,
        runId: 1,
        startTime: new Date("2026-04-16T09:00:00Z"),
        endTime: new Date("2026-04-16T10:00:00Z"),
      } as any);

      expect(result).toEqual(mockBlock);
      expect(db.insert).toHaveBeenCalled();
      expect(chain.values).toHaveBeenCalled();
      expect(chain.returning).toHaveBeenCalled();
    });
  });

  describe("getBlocksForRange", () => {
    it("should filter by userId, startTime >= start, endTime <= end", async () => {
      const blocks = [mockBlock];
      const chain = chainMock(blocks, ["from", "where"]);
      db.select.mockReturnValue(chain);

      const start = new Date("2026-04-16T00:00:00Z");
      const end = new Date("2026-04-16T23:59:59Z");
      const result = await repo.getBlocksForRange("user-1", start, end);

      expect(result).toEqual(blocks);
      expect(db.select).toHaveBeenCalled();
      expect(chain.from).toHaveBeenCalled();
      expect(chain.where).toHaveBeenCalled();
    });

    it("should return empty array when no blocks in range", async () => {
      const chain = chainMock([], ["from", "where"]);
      db.select.mockReturnValue(chain);

      const start = new Date("2026-04-17T00:00:00Z");
      const end = new Date("2026-04-17T23:59:59Z");
      const result = await repo.getBlocksForRange("user-1", start, end);

      expect(result).toEqual([]);
    });
  });

  describe("updateBlockStatus", () => {
    it("should update block status and return it", async () => {
      const updatedBlock = { ...mockBlock, status: "completed" };
      const chain = chainMock([updatedBlock], ["set", "where", "returning"]);
      db.update.mockReturnValue(chain);

      const result = await repo.updateBlockStatus(1, "completed");

      expect(result).toEqual(updatedBlock);
      expect(db.update).toHaveBeenCalled();
      expect(chain.set).toHaveBeenCalled();
      expect(chain.where).toHaveBeenCalled();
      expect(chain.returning).toHaveBeenCalled();
    });

    it("should return null when block not found", async () => {
      const chain = chainMock([], ["set", "where", "returning"]);
      db.update.mockReturnValue(chain);

      const result = await repo.updateBlockStatus(999, "missed");

      expect(result).toBeNull();
    });
  });

  describe("deleteBlock", () => {
    it("should delete block and return it", async () => {
      const chain = chainMock([mockBlock], ["where", "returning"]);
      db.delete.mockReturnValue(chain);

      const result = await repo.deleteBlock(1);

      expect(result).toEqual(mockBlock);
      expect(db.delete).toHaveBeenCalled();
      expect(chain.where).toHaveBeenCalled();
      expect(chain.returning).toHaveBeenCalled();
    });

    it("should return null when block not found", async () => {
      const chain = chainMock([], ["where", "returning"]);
      db.delete.mockReturnValue(chain);

      const result = await repo.deleteBlock(999);

      expect(result).toBeNull();
    });
  });
});
