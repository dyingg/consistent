import { buildThreadId } from "./thread-id";

describe("buildThreadId", () => {
  it("returns `assistant-${userId}` for the default thread", () => {
    expect(buildThreadId("user-123")).toBe("assistant-user-123");
  });

  it("appends a subId when provided", () => {
    expect(buildThreadId("user-123", "deep-work")).toBe(
      "assistant-user-123-deep-work",
    );
  });

  it("rejects empty userId", () => {
    expect(() => buildThreadId("")).toThrow();
  });
});
