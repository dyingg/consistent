/**
 * Shared helpers for the Mastra tool execute() context. The context type
 * isn't exported as a public type by @mastra/core/tools, so we narrow to
 * the fields we actually use.
 */

const RESOURCE_ID_KEY = "mastra__resourceId";

export type ToolContext = {
  requestContext?: { get: (key: string) => unknown };
};

export function getUserId(context: ToolContext): string {
  const userId = context?.requestContext?.get(RESOURCE_ID_KEY);
  if (typeof userId !== "string" || !userId) {
    throw new Error("unauthorized");
  }
  return userId;
}

/**
 * Wraps a tool body so a thrown Error becomes a `{ error, message }` shape
 * the agent can read instead of a Mastra runtime crash.
 */
export async function safe<T>(
  fn: () => Promise<T>,
): Promise<T | { error: true; message: string }> {
  try {
    return await fn();
  } catch (err) {
    return {
      error: true,
      message: err instanceof Error ? err.message : "internal_error",
    };
  }
}
