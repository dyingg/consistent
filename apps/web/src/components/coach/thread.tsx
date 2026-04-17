"use client";
import {
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
} from "@assistant-ui/react";
import { MarkdownText } from "./markdown-text";

export function Thread() {
  return (
    <ThreadPrimitive.Root className="flex flex-col h-[320px] bg-card rounded-xl overflow-hidden">
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
        <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
      </div>
    </MessagePrimitive.Root>
  );
}
