import { Agent } from "@mastra/core/agent";
import type { Memory } from "@mastra/memory";
import { COACH_SYSTEM_PROMPT } from "./prompts/coach";

export interface CoachAgentOptions {
  tools: Record<string, unknown>;
  memory: Memory;
  model: string;
}

/**
 * Instructions are a byte-stable string so Anthropic's prompt cache stays
 * warm across turns. The agent resolves "now" at runtime by calling the
 * get-current-time tool (which reads timezone + client clock from the
 * per-request context set by the browser).
 */
export function createCoachAgent(opts: CoachAgentOptions): Agent {
  return new Agent({
    id: "consistent-coach",
    name: "Consistent Coach",
    instructions: COACH_SYSTEM_PROMPT,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Agent's `model` accepts a string id at runtime; the public type wants a LanguageModel instance
    model: opts.model as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tools is a heterogeneous record by design; Mastra's ToolsInput generic isn't exported
    tools: opts.tools as any,
    memory: opts.memory,
  });
}
