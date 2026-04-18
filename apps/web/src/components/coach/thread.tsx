"use client";
import {
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
} from "@assistant-ui/react";
import { Plus } from "lucide-react";
import { MarkdownText } from "./markdown-text";
import { Reasoning } from "./reasoning";
import { ToolFallback } from "./tool-fallback";
import { TypingIndicator } from "./typing-indicator";

export function Thread({ onNewThread }: { onNewThread?: () => void }) {
  return (
    <ThreadPrimitive.Root className="relative flex flex-col h-[320px] bg-card rounded-xl overflow-hidden">
      {onNewThread ? (
        <button
          type="button"
          onClick={onNewThread}
          aria-label="Start new thread"
          title="Start new thread"
          className="absolute top-2 right-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-md text-foreground/50 hover:text-foreground hover:bg-muted transition-colors"
        >
          <Plus size={14} strokeWidth={2} />
        </button>
      ) : null}
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        <ThreadPrimitive.Empty>
          <p className="text-foreground/60 text-sm">
            Ask about your goals, today, or what to do next.
          </p>
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages
          components={{
            UserMessage: UserMessage,
            AssistantMessage: AssistantMessage,
          }}
        />
      </ThreadPrimitive.Viewport>
      <div className="border-t border-border/40 p-3">
        <ComposerPrimitive.Root className="flex gap-2 items-end">
          <ComposerPrimitive.Input
            placeholder="Message your coach…"
            className="flex-1 resize-none bg-transparent outline-none text-[0.9375rem] placeholder:text-foreground/40"
            rows={1}
          />
          <ComposerPrimitive.Send className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm hover:opacity-90 disabled:opacity-50">
            Send
          </ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </div>
    </ThreadPrimitive.Root>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <div className="max-w-[85%] px-3.5 py-2.5 rounded-lg bg-muted text-foreground text-[0.9375rem] leading-relaxed">
        <MessagePrimitive.Content />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-start">
      <div className="max-w-[85%] text-foreground/80 text-[0.9375rem] leading-relaxed">
        <MessagePrimitive.Parts
          components={{
            Text: MarkdownText,
            Reasoning: Reasoning,
            tools: { Fallback: ToolFallback },
            Empty: EmptyAssistantState,
          }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}

function EmptyAssistantState({
  status,
}: {
  status: { type: "running" | "complete" | "incomplete" | "requires-action" };
}) {
  // Empty renders in two cases: (1) no parts yet before first token, and
  // (2) last part is a tool-call that completed but the model hasn't emitted
  // text yet. Only show the typing indicator while actively running — a
  // completed message with no trailing text shouldn't linger with dots.
  if (status.type !== "running" && status.type !== "requires-action") {
    return null;
  }
  return <TypingIndicator />;
}
