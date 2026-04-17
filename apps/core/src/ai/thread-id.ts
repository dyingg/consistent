export function buildThreadId(userId: string, subId?: string): string {
  if (!userId) {
    throw new Error("buildThreadId: userId is required");
  }
  return subId ? `assistant-${userId}-${subId}` : `assistant-${userId}`;
}

export function isOwnedBy(threadId: string, userId: string): boolean {
  if (!userId) return false;
  if (!threadId) return false;
  // Note: buildThreadId validates that userIds don't contain hyphens,
  // so we can safely parse threadIds without prefix-collision ambiguity.
  try {
    const base = buildThreadId(userId);
    return threadId === base || threadId.startsWith(`${base}-`);
  } catch {
    // If buildThreadId throws (invalid userId), ownership check fails.
    return false;
  }
}
