import { buildThreadId, isOwnedBy } from "./thread-id";

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

describe("isOwnedBy", () => {
  it("returns true for the exact base thread", () => {
    expect(isOwnedBy("assistant-user-123", "user-123")).toBe(true);
  });

  it("returns true for a sub-thread", () => {
    expect(isOwnedBy("assistant-user-123-deep-work", "user-123")).toBe(true);
  });

  it("returns false for a different user", () => {
    expect(isOwnedBy("assistant-user-456", "user-123")).toBe(false);
  });

  it("rejects threads whose name merely shares a prefix (prefix-collision guard)", () => {
    expect(isOwnedBy("assistant-alice", "al")).toBe(false);
    expect(isOwnedBy("assistant-alice-sub", "al")).toBe(false);
  });

  it("returns false for empty userId", () => {
    expect(isOwnedBy("assistant-user-123", "")).toBe(false);
  });

  it("returns false for empty threadId", () => {
    expect(isOwnedBy("", "user-123")).toBe(false);
  });

  it("distinguishes between similar user IDs with correct prefix handling", () => {
    // This test documents that userId 'userid123' is distinct from 'user'
    // and we correctly reject ownership claims across boundary.
    expect(isOwnedBy("assistant-userid123-sub", "userid123")).toBe(true);
    expect(isOwnedBy("assistant-userid123", "user")).toBe(false);
  });
});
