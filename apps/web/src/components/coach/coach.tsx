"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  useChatRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import { useSession } from "@/lib/auth-client";
import { buildThreadId } from "./thread-id";
import { Thread } from "./thread";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

type HistoryMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  parts: Array<{ type: "text"; text: string }>;
  createdAt?: string;
};

const subIdKey = (userId: string) => `coach:subId:${userId}`;

export function Coach() {
  const { data: session } = useSession();
  const userId = session?.user?.id;

  const [subId, setSubId] = useState<string | null>(null);
  const [subIdReady, setSubIdReady] = useState(false);

  useEffect(() => {
    if (!userId) {
      setSubId(null);
      setSubIdReady(false);
      return;
    }
    try {
      setSubId(localStorage.getItem(subIdKey(userId)));
    } catch {
      setSubId(null);
    }
    setSubIdReady(true);
  }, [userId]);

  const threadId = useMemo(
    () => (userId ? buildThreadId(userId, subId ?? undefined) : null),
    [userId, subId],
  );

  const [history, setHistory] = useState<HistoryMessage[] | null>(null);
  const clientCreatedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!threadId) return;
    if (clientCreatedRef.current.has(threadId)) return;
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

  const startNewThread = useCallback(() => {
    if (!userId) return;
    const newSubId =
      globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}`;
    const newThreadId = buildThreadId(userId, newSubId);
    try {
      localStorage.setItem(subIdKey(userId), newSubId);
    } catch {
      // ignore storage errors; in-memory state still rotates
    }
    clientCreatedRef.current.add(newThreadId);
    setHistory([]);
    setSubId(newSubId);
  }, [userId]);

  if (!userId) {
    return (
      <div className="rounded-xl bg-card p-4 text-sm text-foreground/60">
        Sign in to chat with your coach.
      </div>
    );
  }

  if (!subIdReady || history === null) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-xl bg-card p-4 text-sm text-foreground/60">
        Loading conversation…
      </div>
    );
  }

  return (
    <CoachRuntime
      key={threadId ?? "none"}
      userId={userId}
      threadId={threadId!}
      initialMessages={history}
      onNewThread={startNewThread}
    />
  );
}

function CoachRuntime({
  userId,
  threadId,
  initialMessages,
  onNewThread,
}: {
  userId: string;
  threadId: string;
  initialMessages: HistoryMessage[];
  onNewThread: () => void;
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
            requestContext: {
              userTimezone: getBrowserTimezone(),
              clientTime: new Date().toISOString(),
            },
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
      <Thread onNewThread={onNewThread} />
    </AssistantRuntimeProvider>
  );
}
