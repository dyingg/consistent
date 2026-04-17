"use client";
import { useMemo } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  useChatRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import { useSession } from "@/lib/auth-client";
import { buildThreadId } from "./thread-id";
import { createHistoryAdapter } from "./history-adapter";
import { Thread } from "./thread";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export function Coach() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const threadId = userId ? buildThreadId(userId) : null;

  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        api: `${API_URL}/chat/consistent-coach`,
        credentials: "include" as const,
      }),
    [],
  );

  const adapters = useMemo(
    () => ({
      history: threadId ? createHistoryAdapter(API_URL, threadId) : undefined,
    }),
    [threadId],
  );

  const runtime = useChatRuntime({ transport, adapters });

  if (!userId) {
    return (
      <div className="rounded-xl bg-card p-4 text-sm text-foreground/60">
        Sign in to chat with your coach.
      </div>
    );
  }

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  );
}
