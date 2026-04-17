"use client";
import { useEffect, useMemo, useState } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  useChatRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import { useSession } from "@/lib/auth-client";
import { buildThreadId } from "./thread-id";
import { Thread } from "./thread";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type HistoryMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  parts: Array<{ type: "text"; text: string }>;
  createdAt?: string;
};

export function Coach() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const threadId = userId ? buildThreadId(userId) : null;

  const [history, setHistory] = useState<HistoryMessage[] | null>(null);

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    setHistory(null);
    (async () => {
      try {
        const res = await fetch(
          `${API_URL}/v1/ai/threads/${encodeURIComponent(threadId)}/messages`,
          { credentials: "include" },
        );
        if (!res.ok) {
          if (!cancelled) setHistory([]);
          return;
        }
        const data = (await res.json()) as { messages: HistoryMessage[] };
        if (cancelled) return;
        setHistory(data.messages);
      } catch {
        if (!cancelled) setHistory([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  if (!userId) {
    return (
      <div className="rounded-xl bg-card p-4 text-sm text-foreground/60">
        Sign in to chat with your coach.
      </div>
    );
  }

  if (history === null) {
    return (
      <div className="rounded-xl bg-card p-4 text-sm text-foreground/60">
        Loading conversation…
      </div>
    );
  }

  return (
    <CoachRuntime
      userId={userId}
      threadId={threadId!}
      initialMessages={history}
    />
  );
}

function CoachRuntime({
  userId,
  threadId,
  initialMessages,
}: {
  userId: string;
  threadId: string;
  initialMessages: HistoryMessage[];
}) {
  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        api: `${API_URL}/chat/consistent-coach`,
        credentials: "include" as const,
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: {
            ...(body ?? {}),
            messages,
            memory: { resource: userId, thread: threadId },
          },
        }),
      }),
    [threadId, userId],
  );

  const runtime = useChatRuntime({
    transport,
    messages: initialMessages as never,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  );
}
