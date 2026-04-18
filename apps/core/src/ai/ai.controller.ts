import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  UseGuards,
} from "@nestjs/common";
import type { Memory } from "@mastra/memory";
import type { AuthUser } from "@consistent/auth";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/auth.decorator";
import { isOwnedBy } from "./thread-id";

export const MEMORY = Symbol("MEMORY");

type MemoryWithRecall = Memory & {
  recall: (input: { threadId: string; resourceId: string }) => Promise<{
    messages?: Array<Record<string, unknown>>;
  }>;
};

@Controller({ version: "1", path: "ai" })
@UseGuards(AuthGuard)
export class AiController {
  constructor(@Inject(MEMORY) private readonly memory: Memory) {}

  @Get("threads/:threadId/messages")
  async getThreadMessages(
    @CurrentUser() user: AuthUser,
    @Param("threadId") threadId: string,
  ) {
    if (!isOwnedBy(threadId, user.id)) {
      throw new ForbiddenException("thread not owned by authenticated user");
    }

    // recall() is on Memory at runtime but isn't in @mastra/memory's exported
    // type — narrow locally instead of casting through any.
    const result = await (this.memory as MemoryWithRecall).recall({
      threadId,
      resourceId: user.id,
    });

    const messages = result?.messages ?? [];

    return {
      messages: messages
        .map((m) => {
          const text = extractText(m.content);
          if (!text) return null;
          return {
            id: m.id,
            role: m.role,
            parts: [{ type: "text", text }],
            createdAt:
              m.createdAt instanceof Date
                ? m.createdAt.toISOString()
                : m.createdAt,
          };
        })
        .filter(Boolean),
    };
  }
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!content || typeof content !== "object") return "";
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter(
      (p): p is { type: string; text: string } =>
        !!p &&
        typeof p === "object" &&
        (p as { type?: unknown }).type === "text" &&
        typeof (p as { text?: unknown }).text === "string",
    )
    .map((p) => p.text)
    .join("");
}
