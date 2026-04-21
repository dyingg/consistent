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

type StructuredError = { error: true; message: string } & Record<
  string,
  unknown
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasResponse(value: unknown): value is { getResponse: () => unknown } {
  return (
    isRecord(value) &&
    "getResponse" in value &&
    typeof value.getResponse === "function"
  );
}

function messageFromResponse(response: unknown, fallback: string) {
  if (typeof response === "string") return response;
  if (!isRecord(response)) return fallback;

  const message = response.message;
  if (typeof message === "string") return message;
  if (Array.isArray(message) && message.every((item) => typeof item === "string")) {
    return message.join("; ");
  }

  return fallback;
}

/**
 * Wraps a tool body so a thrown Error becomes a `{ error, message }` shape
 * the agent can read instead of a Mastra runtime crash.
 */
export async function safe<T>(
  fn: () => Promise<T>,
): Promise<T | StructuredError> {
  try {
    return await fn();
  } catch (err) {
    const fallbackMessage = err instanceof Error ? err.message : "internal_error";
    if (hasResponse(err)) {
      const response = err.getResponse();
      const message = messageFromResponse(response, fallbackMessage);
      if (isRecord(response)) {
        return { ...response, error: true, message };
      }
      return { error: true, message, details: response };
    }

    return {
      error: true,
      message: fallbackMessage,
    };
  }
}
