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
import { DRIZZLE } from "../db/types";

// Mock the barrel export so we don't pull in DrizzleModule -> env -> ESM deps
jest.mock("../db", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory cannot reference outer-scope vars; require() is the documented escape
  DRIZZLE: require("../db/types").DRIZZLE,
}));

import { UsersRepository } from "./users.repository";

/**
 * Helper: builds a chainable mock that mimics Drizzle's fluent query API.
 * The last method in the chain resolves to `result`.
 */
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

describe("UsersRepository", () => {
  let repo: UsersRepository;
  let db: Record<string, jest.Mock>;

  const mockUser = {
    id: "user-1",
    name: "Test User",
    email: "test@example.com",
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    timezone: "UTC",
    preferences: {},
  };

  beforeEach(async () => {
    db = {
      select: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersRepository,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();

    repo = module.get<UsersRepository>(UsersRepository);
  });

  describe("findById", () => {
    it("should return user when found", async () => {
      const chain = chainMock([mockUser], ["from", "where", "limit"]);
      db.select.mockReturnValue(chain);

      const result = await repo.findById("user-1");

      expect(result).toEqual(mockUser);
      expect(db.select).toHaveBeenCalled();
      expect(chain.from).toHaveBeenCalled();
      expect(chain.where).toHaveBeenCalled();
      expect(chain.limit).toHaveBeenCalledWith(1);
    });

    it("should return null when not found", async () => {
      const chain = chainMock([], ["from", "where", "limit"]);
      db.select.mockReturnValue(chain);

      const result = await repo.findById("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("findByEmail", () => {
    it("should return user when found", async () => {
      const chain = chainMock([mockUser], ["from", "where", "limit"]);
      db.select.mockReturnValue(chain);

      const result = await repo.findByEmail("test@example.com");

      expect(result).toEqual(mockUser);
      expect(db.select).toHaveBeenCalled();
      expect(chain.from).toHaveBeenCalled();
      expect(chain.where).toHaveBeenCalled();
      expect(chain.limit).toHaveBeenCalledWith(1);
    });

    it("should return null when not found", async () => {
      const chain = chainMock([], ["from", "where", "limit"]);
      db.select.mockReturnValue(chain);

      const result = await repo.findByEmail("none@example.com");

      expect(result).toBeNull();
    });
  });

  describe("updatePreferences", () => {
    it("should call update with correct data and return updated user", async () => {
      const updatedUser = { ...mockUser, preferences: { theme: "dark" } };
      const chain = chainMock([updatedUser], ["set", "where", "returning"]);
      db.update.mockReturnValue(chain);

      const result = await repo.updatePreferences("user-1", {
        theme: "dark",
      } as any);

      expect(result).toEqual(updatedUser);
      expect(db.update).toHaveBeenCalled();
      expect(chain.set).toHaveBeenCalled();
      expect(chain.where).toHaveBeenCalled();
      expect(chain.returning).toHaveBeenCalled();
    });

    it("should return null when user not found", async () => {
      const chain = chainMock([], ["set", "where", "returning"]);
      db.update.mockReturnValue(chain);

      const result = await repo.updatePreferences("nonexistent", {} as any);

      expect(result).toBeNull();
    });
  });

  describe("updateTimezone", () => {
    it("should call update with correct timezone and return updated user", async () => {
      const updatedUser = { ...mockUser, timezone: "America/New_York" };
      const chain = chainMock([updatedUser], ["set", "where", "returning"]);
      db.update.mockReturnValue(chain);

      const result = await repo.updateTimezone("user-1", "America/New_York");

      expect(result).toEqual(updatedUser);
      expect(db.update).toHaveBeenCalled();
      expect(chain.set).toHaveBeenCalled();
      expect(chain.where).toHaveBeenCalled();
      expect(chain.returning).toHaveBeenCalled();
    });

    it("should return null when user not found", async () => {
      const chain = chainMock([], ["set", "where", "returning"]);
      db.update.mockReturnValue(chain);

      const result = await repo.updateTimezone("nonexistent", "UTC");

      expect(result).toBeNull();
    });
  });
});