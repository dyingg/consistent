import type { ThreadHistoryAdapter } from "@assistant-ui/react";

export function createHistoryAdapter(
  apiUrl: string,
  threadId: string,
): ThreadHistoryAdapter {
  return {
    async load() {
      try {
        const res = await fetch(
          `${apiUrl}/v1/ai/threads/${encodeURIComponent(threadId)}/messages`,
          { credentials: "include" },
        );
        if (!res.ok) return { messages: [] };
        const data = (await res.json()) as {
          messages: Array<{
            id: string;
            role: "user" | "assistant" | "system";
            content: unknown;
            createdAt: string;
          }>;
        };
        let prevId: string | null = null;
        const repoMessages = data.messages.map((m) => {
          const threadMessage = {
            id: m.id,
            role: m.role,
            content:
              typeof m.content === "string"
                ? [{ type: "text" as const, text: m.content }]
                : (m.content as any),
            createdAt: new Date(m.createdAt),
            metadata: { unstable_data: [], unstable_state: null, custom: {} },
            status: { type: "complete" as const, reason: "stop" as const },
          } as any;
          const entry = { message: threadMessage, parentId: prevId };
          prevId = m.id;
          return entry;
        });
        return { messages: repoMessages };
      } catch {
        return { messages: [] };
      }
    },
    async append() {
      // Server persists via chatRoute — no-op here prevents double-writes.
    },
  };
}
