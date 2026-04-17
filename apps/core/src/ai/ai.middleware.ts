import type { Request, Response, NextFunction } from "express";
import { buildThreadId, isOwnedBy } from "./thread-id";

const RESOURCE_ID_KEY = "mastra__resourceId";

/**
 * Runs before chatRoute on /chat/*.
 * Reads resourceId from Mastra's requestContext (populated by the auth provider).
 * Overwrites req.body.memory so clients cannot target another user's thread.
 * Accepts an optional body.threadSubId to allow future multi-thread support.
 */
export function chatMemoryGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestContext = res.locals.requestContext as
    | { get: (k: string) => unknown }
    | undefined;
  const userId = requestContext?.get(RESOURCE_ID_KEY) as string | undefined;

  if (!userId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const subId =
    typeof body.threadSubId === "string" ? body.threadSubId : undefined;
  const thread = buildThreadId(userId, subId);

  const clientMemory = body.memory as
    | { thread?: string; resource?: string }
    | undefined;
  if (clientMemory?.thread && !isOwnedBy(clientMemory.thread, userId)) {
    res
      .status(403)
      .json({ error: "thread not owned by authenticated user" });
    return;
  }

  body.memory = { resource: userId, thread };
  req.body = body;

  next();
}
