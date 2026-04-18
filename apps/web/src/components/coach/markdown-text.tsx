"use client";
import { memo } from "react";
import {
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
} from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";

const components = memoizeMarkdownComponents({
  h1: ({ className, ...props }) => (
    <h1
      className={`mt-4 mb-2 text-lg font-semibold text-foreground first:mt-0 ${className ?? ""}`}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={`mt-4 mb-2 text-base font-semibold text-foreground first:mt-0 ${className ?? ""}`}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={`mt-3 mb-1.5 text-[0.9375rem] font-semibold text-foreground first:mt-0 ${className ?? ""}`}
      {...props}
    />
  ),
  p: ({ className, ...props }) => (
    <p
      className={`leading-relaxed [&:not(:first-child)]:mt-2 ${className ?? ""}`}
      {...props}
    />
  ),
  a: ({ className, ...props }) => (
    <a
      className={`text-primary underline underline-offset-2 hover:opacity-80 ${className ?? ""}`}
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
  strong: ({ className, ...props }) => (
    <strong
      className={`font-semibold text-foreground ${className ?? ""}`}
      {...props}
    />
  ),
  em: ({ className, ...props }) => (
    <em className={`italic ${className ?? ""}`} {...props} />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={`my-2 ml-5 list-disc space-y-1 marker:text-foreground/40 ${className ?? ""}`}
      {...props}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={`my-2 ml-5 list-decimal space-y-1 marker:text-foreground/40 ${className ?? ""}`}
      {...props}
    />
  ),
  li: ({ className, ...props }) => (
    <li className={`leading-relaxed ${className ?? ""}`} {...props} />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={`my-2 border-l-2 border-border/60 pl-3 text-foreground/70 italic ${className ?? ""}`}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr className={`my-3 border-border/40 ${className ?? ""}`} {...props} />
  ),
  code: ({ className, ...props }) => (
    <code
      className={`rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] ${className ?? ""}`}
      {...props}
    />
  ),
  pre: ({ className, ...props }) => (
    <pre
      className={`my-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-[0.85em] leading-relaxed ${className ?? ""}`}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <div className="my-2 overflow-x-auto">
      <table
        className={`w-full border-collapse text-sm ${className ?? ""}`}
        {...props}
      />
    </div>
  ),
  th: ({ className, ...props }) => (
    <th
      className={`border-b border-border/60 px-2 py-1 text-left font-semibold ${className ?? ""}`}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={`border-b border-border/30 px-2 py-1 ${className ?? ""}`}
      {...props}
    />
  ),
});

const MarkdownTextImpl = () => (
  <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} components={components} />
);

export const MarkdownText = memo(MarkdownTextImpl);
