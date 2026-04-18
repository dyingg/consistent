"use client";
import { Sparkles } from "lucide-react";

export function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 text-foreground/60 animate-in fade-in">
      <Sparkles size={14} className="animate-pulse text-primary/70" />
      <span className="inline-flex gap-1">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full bg-foreground/40 animate-bounce"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="inline-block h-1.5 w-1.5 rounded-full bg-foreground/40 animate-bounce"
          style={{ animationDelay: "150ms" }}
        />
        <span
          className="inline-block h-1.5 w-1.5 rounded-full bg-foreground/40 animate-bounce"
          style={{ animationDelay: "300ms" }}
        />
      </span>
    </div>
  );
}
