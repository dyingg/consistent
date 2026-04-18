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
import type { UsersRepository } from "../../users/users.repository";
import { createTimeTools } from "./time.tools";

function makeContext(entries: Record<string, string | undefined>) {
  return {
    requestContext: {
      get: (key: string) => entries[key],
      set: jest.fn(),
      has: jest.fn(),
    },
  } as any;
}

describe("time tools", () => {
  let usersRepository: jest.Mocked<UsersRepository>;

  beforeEach(() => {
    usersRepository = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      updatePreferences: jest.fn(),
      updateTimezone: jest.fn(),
    } as unknown as jest.Mocked<UsersRepository>;
  });

  it("uses timezone from requestContext when present and valid", async () => {
    usersRepository.findById.mockResolvedValue({
      id: "user-123",
      timezone: "America/Los_Angeles",
    } as any);
    const tools = createTimeTools(usersRepository);
    const ctx = makeContext({
      mastra__resourceId: "user-123",
      userTimezone: "America/Los_Angeles",
      clientTime: "2026-04-18T20:00:00.000Z",
    });

    const result = (await tools["get-current-time"].execute!({}, ctx)) as any;

    expect(result.timezone).toBe("America/Los_Angeles");
    expect(result.currentTime).toBe("2026-04-18T20:00:00.000Z");
    expect(result.localDate).toBe("2026-04-18");
    expect(result.weekday).toBe("Saturday");
    expect(result.offset).toBe("-07:00");
    // the timezone matched stored value, so no update
    expect(usersRepository.updateTimezone).not.toHaveBeenCalled();
  });

  it("returns a positive offset for Asia/Tokyo", async () => {
    usersRepository.findById.mockResolvedValue({
      id: "user-123",
      timezone: "Asia/Tokyo",
    } as any);
    const tools = createTimeTools(usersRepository);
    const ctx = makeContext({
      mastra__resourceId: "user-123",
      userTimezone: "Asia/Tokyo",
      clientTime: "2026-04-18T20:00:00.000Z",
    });

    const result = (await tools["get-current-time"].execute!({}, ctx)) as any;

    expect(result.offset).toBe("+09:00");
  });

  it("returns +00:00 for UTC", async () => {
    usersRepository.findById.mockResolvedValue({
      id: "user-123",
      timezone: "UTC",
    } as any);
    const tools = createTimeTools(usersRepository);
    const ctx = makeContext({
      mastra__resourceId: "user-123",
      userTimezone: "UTC",
      clientTime: "2026-04-18T20:00:00.000Z",
    });

    const result = (await tools["get-current-time"].execute!({}, ctx)) as any;

    expect(result.offset).toBe("+00:00");
  });

  it("returns a half-hour offset for Asia/Kolkata", async () => {
    usersRepository.findById.mockResolvedValue({
      id: "user-123",
      timezone: "Asia/Kolkata",
    } as any);
    const tools = createTimeTools(usersRepository);
    const ctx = makeContext({
      mastra__resourceId: "user-123",
      userTimezone: "Asia/Kolkata",
      clientTime: "2026-04-18T20:00:00.000Z",
    });

    const result = (await tools["get-current-time"].execute!({}, ctx)) as any;

    expect(result.offset).toBe("+05:30");
  });

  it("falls back to stored DB timezone when context has no tz", async () => {
    usersRepository.findById.mockResolvedValue({
      id: "user-123",
      timezone: "Asia/Tokyo",
    } as any);
    const tools = createTimeTools(usersRepository);
    const ctx = makeContext({
      mastra__resourceId: "user-123",
      clientTime: "2026-04-18T20:00:00.000Z",
    });

    const result = (await tools["get-current-time"].execute!({}, ctx)) as any;

    expect(result.timezone).toBe("Asia/Tokyo");
    expect(usersRepository.updateTimezone).not.toHaveBeenCalled();
  });

  it("falls back to UTC when neither context nor DB have a valid tz", async () => {
    usersRepository.findById.mockResolvedValue(null);
    const tools = createTimeTools(usersRepository);
    const ctx = makeContext({ mastra__resourceId: "user-123" });

    const result = (await tools["get-current-time"].execute!({}, ctx)) as any;

    expect(result.timezone).toBe("UTC");
  });

  it("ignores an invalid browser-supplied timezone and falls back to DB", async () => {
    usersRepository.findById.mockResolvedValue({
      id: "user-123",
      timezone: "Europe/Berlin",
    } as any);
    const tools = createTimeTools(usersRepository);
    const ctx = makeContext({
      mastra__resourceId: "user-123",
      userTimezone: "Not/A_Real_Zone",
    });

    const result = (await tools["get-current-time"].execute!({}, ctx)) as any;

    expect(result.timezone).toBe("Europe/Berlin");
    expect(usersRepository.updateTimezone).not.toHaveBeenCalled();
  });

  it("updates stored timezone when browser tz differs", async () => {
    usersRepository.findById.mockResolvedValue({
      id: "user-123",
      timezone: "UTC",
    } as any);
    usersRepository.updateTimezone.mockResolvedValue({} as any);
    const tools = createTimeTools(usersRepository);
    const ctx = makeContext({
      mastra__resourceId: "user-123",
      userTimezone: "America/New_York",
    });

    await tools["get-current-time"].execute!({}, ctx);
    // best-effort update runs asynchronously; await the next tick
    await new Promise((r) => setImmediate(r));

    expect(usersRepository.updateTimezone).toHaveBeenCalledWith(
      "user-123",
      "America/New_York",
    );
  });

  it("throws when userId is missing from requestContext", async () => {
    const tools = createTimeTools(usersRepository);
    const ctx = makeContext({});
    await expect(
      tools["get-current-time"].execute!({}, ctx),
    ).rejects.toThrow("unauthorized");
  });

  it("prefers clientTime from context over server clock", async () => {
    usersRepository.findById.mockResolvedValue({
      id: "user-123",
      timezone: "UTC",
    } as any);
    const tools = createTimeTools(usersRepository);
    const ctx = makeContext({
      mastra__resourceId: "user-123",
      userTimezone: "UTC",
      clientTime: "2030-01-01T12:00:00.000Z",
    });

    const result = (await tools["get-current-time"].execute!({}, ctx)) as any;
    expect(result.currentTime).toBe("2030-01-01T12:00:00.000Z");
    expect(result.localDate).toBe("2030-01-01");
  });
});