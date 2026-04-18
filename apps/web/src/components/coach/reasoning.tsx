"use client";
import { useState } from "react";
import { Brain, ChevronRight } from "lucide-react";
import type { ReasoningMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";

const Reasoning: ReasoningMessagePartComponent = ({ text, status }) => {
  const isRunning = status.type === "running";
  // Default open while streaming, collapsed once done. A click flips the
  // override for the *current* phase only, so the auto-behavior resumes
  // when the phase changes (e.g., running → complete collapses again).
  const [override, setOverride] = useState<{
    running: boolean;
    open: boolean;
  } | null>(null);
  const open =
    override && override.running === isRunning ? override.open : isRunning;

  if (!text) return null;

  return (
    <div className="my-1.5 rounded-md border border-border/40 bg-muted/30">
      <button
        type="button"
        onClick={() => setOverride({ running: isRunning, open: !open })}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-[0.8125rem] text-foreground/70 hover:text-foreground transition-colors"
      >
        <Brain
          size={13}
          className={cn(
            "text-primary/70 shrink-0",
            isRunning && "animate-pulse",
          )}
          strokeWidth={2}
        />
        <span className={cn("font-medium", isRunning && "animate-pulse")}>
          {isRunning ? "Thinking…" : "Thought for a moment"}
        </span>
        <ChevronRight
          size={13}
          className={cn(
            "ml-auto shrink-0 text-foreground/40 transition-transform duration-200",
            open && "rotate-90",
          )}
          strokeWidth={2}
        />
      </button>
      {open ? (
        <div className="border-t border-border/40 px-3 py-2 text-[0.8125rem] leading-relaxed text-foreground/60 italic whitespace-pre-wrap animate-in fade-in slide-in-from-top-1 duration-150">
          {text}
        </div>
      ) : null}
    </div>
  );
};

export { Reasoning };
