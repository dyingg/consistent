export function buildThreadId(userId: string, subId?: string): string {
  if (!userId) {
    throw new Error("buildThreadId: userId is required");
  }
  return subId ? `assistant-${userId}-${subId}` : `assistant-${userId}`;
}
