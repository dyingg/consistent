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
import { BadRequestException } from "@nestjs/common";
import { DRIZZLE } from "../db/types";

jest.mock("../db", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory cannot reference outer-scope vars; require() is the documented escape
  DRIZZLE: require("../db/types").DRIZZLE,
}));

import { DependenciesRepository } from "./dependencies.repository";

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

describe("DependenciesRepository", () => {
  let repo: DependenciesRepository;
  let db: Record<string, jest.Mock>;

  const mockDependency = {
    taskId: 1,
    dependsOnId: 2,
    type: "blocks",
    createdAt: new Date(),
  };

  beforeEach(async () => {
    db = {
      select: jest.fn(),
      insert: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DependenciesRepository,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();

    repo = module.get<DependenciesRepository>(DependenciesRepository);
  });

  describe("create", () => {
    it("should insert dependency edge and return it", async () => {
      const chain = chainMock([mockDependency], ["values", "returning"]);
      db.insert.mockReturnValue(chain);

      const result = await repo.create({
        taskId: 1,
        dependsOnId: 2,
      } as any);

      expect(result).toEqual(mockDependency);
      expect(db.insert).toHaveBeenCalled();
      expect(chain.values).toHaveBeenCalled();
      expect(chain.returning).toHaveBeenCalled();
    });

    it("should catch cycle detection error (code 23514) and throw BadRequestException", async () => {
      const chain = chainMock(null, ["values", "returning"]);
      chain.returning!.mockRejectedValue({ code: "23514", message: "check_violation" });
      db.insert.mockReturnValue(chain);

      await expect(repo.create({ taskId: 1, dependsOnId: 2 } as any)).rejects.toThrow(
        BadRequestException,
      );
      await expect(repo.create({ taskId: 1, dependsOnId: 2 } as any)).rejects.toThrow(
        "Adding this dependency would create a circular dependency",
      );
    });

    it("should catch cycle detection error with 'cycle detected' message", async () => {
      const chain = chainMock(null, ["values", "returning"]);
      chain.returning!.mockRejectedValue({ message: "cycle detected in dependencies" });
      db.insert.mockReturnValue(chain);

      await expect(repo.create({ taskId: 1, dependsOnId: 2 } as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should re-throw non-cycle errors", async () => {
      const chain = chainMock(null, ["values", "returning"]);
      const genericError = new Error("Connection lost");
      chain.returning!.mockRejectedValue(genericError);
      db.insert.mockReturnValue(chain);

      await expect(repo.create({ taskId: 1, dependsOnId: 2 } as any)).rejects.toThrow(
        "Connection lost",
      );
      await expect(repo.create({ taskId: 1, dependsOnId: 2 } as any)).rejects.not.toThrow(
        BadRequestException,
      );
    });
  });

  describe("findByTaskId", () => {
    it("should return dependencies where taskId matches", async () => {
      const deps = [mockDependency];
      const chain = chainMock(deps, ["from", "where"]);
      db.select.mockReturnValue(chain);

      const result = await repo.findByTaskId(1);

      expect(result).toEqual(deps);
      expect(db.select).toHaveBeenCalled();
      expect(chain.from).toHaveBeenCalled();
      expect(chain.where).toHaveBeenCalled();
    });
  });

  describe("findByDependsOnId", () => {
    it("should return dependencies where dependsOnId matches", async () => {
      const deps = [mockDependency];
      const chain = chainMock(deps, ["from", "where"]);
      db.select.mockReturnValue(chain);

      const result = await repo.findByDependsOnId(2);

      expect(result).toEqual(deps);
      expect(db.select).toHaveBeenCalled();
      expect(chain.from).toHaveBeenCalled();
      expect(chain.where).toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("should delete specific edge and return it", async () => {
      const chain = chainMock([mockDependency], ["where", "returning"]);
      db.delete.mockReturnValue(chain);

      const result = await repo.delete(1, 2);

      expect(result).toEqual(mockDependency);
      expect(db.delete).toHaveBeenCalled();
      expect(chain.where).toHaveBeenCalled();
      expect(chain.returning).toHaveBeenCalled();
    });

    it("should return null when edge not found", async () => {
      const chain = chainMock([], ["where", "returning"]);
      db.delete.mockReturnValue(chain);

      const result = await repo.delete(99, 100);

      expect(result).toBeNull();
    });
  });
});