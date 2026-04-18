"use client";
import { useEffect, useState } from "react";
import {
  LoaderCircle,
  CircleCheck,
  CircleX,
  ChevronRight,
} from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";

function formatToolName(name: string): string {
  return name
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function formatValue(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function hasArgs(args: unknown): args is Record<string, unknown> {
  return !!args && typeof args === "object" && Object.keys(args).length > 0;
}

export const ToolFallback: ToolCallMessagePartComponent = ({
  toolName,
  args,
  argsText,
  result,
  isError,
  status,
}) => {
  const phase = isError
    ? "error"
    : status.type === "running" || status.type === "requires-action"
      ? "running"
      : status.type === "incomplete"
        ? "error"
        : "complete";

  // Auto-open while running, auto-close when done; user can still toggle.
  const [open, setOpen] = useState(phase === "running");
  useEffect(() => {
    if (phase === "running") setOpen(true);
    else if (phase === "complete") setOpen(false);
  }, [phase]);

  const pretty = formatToolName(toolName);
  const argsBody = hasArgs(args) ? formatValue(args) : argsText?.trim() || "";
  const resultBody = result === undefined ? "" : formatValue(result);

  return (
    <div
      className={cn(
        "my-1.5 overflow-hidden rounded-md border text-[0.8125rem] transition-colors",
        phase === "error"
          ? "border-destructive/40 bg-destructive/5"
          : "border-border/50 bg-muted/30",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-foreground/80 hover:text-foreground transition-colors"
      >
        <StatusIcon phase={phase} />
        <span className="font-medium">
          {phase === "running"
            ? verbFor(pretty, "running")
            : phase === "error"
              ? `${pretty} failed`
              : pretty}
        </span>
        <ArgsSummary args={args} argsText={argsText} />
        <ChevronRight
          size={13}
          strokeWidth={2}
          className={cn(
            "ml-auto shrink-0 text-foreground/40 transition-transform duration-200",
            open && "rotate-90",
          )}
        />
      </button>
      {open ? (
        <div className="border-t border-border/40 px-3 py-2 space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
          {argsBody ? (
            <Section label="Arguments">
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[0.75rem] leading-relaxed text-foreground/70">
                {argsBody}
              </pre>
            </Section>
          ) : null}
          {phase === "complete" && resultBody ? (
            <Section label="Result">
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[0.75rem] leading-relaxed text-foreground/70">
                {resultBody}
              </pre>
            </Section>
          ) : null}
          {phase === "error" ? (
            <Section label="Error" tone="error">
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[0.75rem] leading-relaxed text-destructive/90">
                {resultBody ||
                  (status.type === "incomplete"
                    ? `Tool call ${status.reason}`
                    : "Tool call failed")}
              </pre>
            </Section>
          ) : null}
          {phase === "running" && !resultBody ? (
            <div className="flex items-center gap-1.5 text-[0.75rem] text-foreground/50">
              <LoaderCircle size={11} className="animate-spin" />
              <span>Working…</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

function Section({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: "error";
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className={cn(
          "mb-1 text-[0.6875rem] font-medium uppercase tracking-wider",
          tone === "error" ? "text-destructive/80" : "text-foreground/40",
        )}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function StatusIcon({
  phase,
}: {
  phase: "running" | "complete" | "error";
}) {
  if (phase === "running") {
    return (
      <LoaderCircle
        size={13}
        strokeWidth={2.25}
        className="shrink-0 animate-spin text-primary/80"
      />
    );
  }
  if (phase === "error") {
    return (
      <CircleX
        size={13}
        strokeWidth={2.25}
        className="shrink-0 text-destructive"
      />
    );
  }
  return (
    <CircleCheck
      size={13}
      strokeWidth={2.25}
      className="shrink-0 text-emerald-500/90"
    />
  );
}

function ArgsSummary({
  args,
  argsText,
}: {
  args: unknown;
  argsText?: string;
}) {
  const summary = summarizeArgs(args, argsText);
  if (!summary) return null;
  return (
    <span className="truncate text-foreground/50 text-[0.75rem] font-normal">
      {summary}
    </span>
  );
}

function summarizeArgs(args: unknown, argsText?: string): string {
  if (hasArgs(args)) {
    const entries = Object.entries(args).slice(0, 2);
    const parts = entries.map(([k, v]) => {
      const formatted =
        typeof v === "string"
          ? `"${truncate(v, 24)}"`
          : typeof v === "number" || typeof v === "boolean"
            ? String(v)
            : Array.isArray(v)
              ? `[${v.length}]`
              : "{…}";
      return `${k}: ${formatted}`;
    });
    const more = Object.keys(args).length - entries.length;
    return `(${parts.join(", ")}${more > 0 ? `, +${more}` : ""})`;
  }
  const text = argsText?.trim();
  if (!text) return "";
  return truncate(text.replace(/\s+/g, " "), 40);
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function verbFor(pretty: string, _phase: "running"): string {
  // Distinguish a few common tool verbs so streaming reads naturally.
  const lower = pretty.toLowerCase();
  if (lower.startsWith("get ") || lower.startsWith("find ")) {
    return `${pretty}…`;
  }
  if (lower.startsWith("create ")) {
    return `Creating${pretty.slice("create".length)}…`;
  }
  if (lower.startsWith("update ")) {
    return `Updating${pretty.slice("update".length)}…`;
  }
  if (lower.startsWith("delete ")) {
    return `Deleting${pretty.slice("delete".length)}…`;
  }
  return `${pretty}…`;
}

