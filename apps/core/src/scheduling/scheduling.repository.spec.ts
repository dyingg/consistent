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

  describe("updateBlock", () => {
    it("should update partial columns and return row", async () => {
      const updatedBlock = {
        ...mockBlock,
        startTime: new Date("2026-04-16T09:30:00Z"),
      };
      const chain = chainMock([updatedBlock], ["set", "where", "returning"]);
      db.update.mockReturnValue(chain);

      const result = await repo.updateBlock(1, {
        startTime: new Date("2026-04-16T09:30:00Z"),
      });

      expect(result).toEqual(updatedBlock);
      expect(chain.set).toHaveBeenCalledWith({
        startTime: new Date("2026-04-16T09:30:00Z"),
      });
    });

    it("should forward multiple fields to set()", async () => {
      const chain = chainMock([mockBlock], ["set", "where", "returning"]);
      db.update.mockReturnValue(chain);

      await repo.updateBlock(1, {
        status: "completed",
        taskId: 42,
        endTime: new Date("2026-04-16T11:00:00Z"),
      });

      expect(chain.set).toHaveBeenCalledWith({
        status: "completed",
        taskId: 42,
        endTime: new Date("2026-04-16T11:00:00Z"),
      });
    });

    it("should return null when no row updated", async () => {
      const chain = chainMock([], ["set", "where", "returning"]);
      db.update.mockReturnValue(chain);

      const result = await repo.updateBlock(999, { status: "completed" });

      expect(result).toBeNull();
    });
  });

  describe("findOverlapping", () => {
    it("should run a select filtered by userId and time range", async () => {
      const blocks = [mockBlock];
      const chain = chainMock(blocks, ["from", "where"]);
      db.select.mockReturnValue(chain);

      const result = await repo.findOverlapping(
        "user-1",
        new Date("2026-04-16T09:00:00Z"),
        new Date("2026-04-16T10:00:00Z"),
      );

      expect(result).toEqual(blocks);
      expect(db.select).toHaveBeenCalled();
      expect(chain.where).toHaveBeenCalled();
    });

    it("should accept excludeIds and still return rows", async () => {
      const chain = chainMock([], ["from", "where"]);
      db.select.mockReturnValue(chain);

      const result = await repo.findOverlapping(
        "user-1",
        new Date("2026-04-16T09:00:00Z"),
        new Date("2026-04-16T10:00:00Z"),
        [1, 2],
      );

      expect(result).toEqual([]);
      expect(chain.where).toHaveBeenCalled();
    });
  });

  describe("shiftBlocks", () => {
    it("should update each block atomically and return the rows", async () => {
      const tx = {
        update: jest.fn(),
      };
      const chain = chainMock([mockBlock], ["set", "where", "returning"]);
      tx.update.mockReturnValue(chain);
      db.transaction = jest.fn(async (cb: any) => cb(tx));

      const result = await repo.shiftBlocks([1, 2], 30);

      expect(db.transaction).toHaveBeenCalled();
      expect(tx.update).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
    });

    it("should return empty array when given no ids", async () => {
      db.transaction = jest.fn(async (cb: any) => cb({ update: jest.fn() }));
      const result = await repo.shiftBlocks([], 30);
      expect(result).toEqual([]);
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

  describe("getBlocksForRangeWithDetails", () => {
    it("should query with orderBy for deterministic time ordering", async () => {
      const enrichedBlock = {
        ...mockBlock,
        task: { id: 10, title: "Read", status: "pending", goalId: 1 },
        goal: { id: 1, title: "Learning", color: "#f00" },
      };
      const chain = chainMock([enrichedBlock], [
        "from",
        "innerJoin",
        "innerJoin",
        "where",
        "orderBy",
      ]);
      db.select.mockReturnValue(chain);

      const start = new Date("2026-04-16T00:00:00Z");
      const end = new Date("2026-04-16T23:59:59Z");
      const result = await repo.getBlocksForRangeWithDetails("user-1", start, end);

      expect(result).toEqual([enrichedBlock]);
      expect(chain.orderBy).toHaveBeenCalled();
    });
  });

  describe("getCurrentBlock", () => {
    it("should query with orderBy for index-optimal scan", async () => {
      const enrichedBlock = {
        ...mockBlock,
        task: { id: 10, title: "Read", status: "pending", goalId: 1 },
        goal: { id: 1, title: "Learning", color: "#f00" },
      };
      const chain = chainMock([enrichedBlock], [
        "from",
        "innerJoin",
        "innerJoin",
        "where",
        "orderBy",
        "limit",
      ]);
      db.select.mockReturnValue(chain);

      const result = await repo.getCurrentBlock("user-1");

      expect(result).toEqual(enrichedBlock);
      expect(chain.orderBy).toHaveBeenCalled();
      expect(chain.limit).toHaveBeenCalled();
    });

    it("should return null when no current block", async () => {
      const chain = chainMock([], [
        "from",
        "innerJoin",
        "innerJoin",
        "where",
        "orderBy",
        "limit",
      ]);
      db.select.mockReturnValue(chain);

      const result = await repo.getCurrentBlock("user-1");

      expect(result).toBeNull();
    });
  });
});
