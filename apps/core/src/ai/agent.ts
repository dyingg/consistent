import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import type { Memory } from "@mastra/memory";
import { COACH_SYSTEM_PROMPT } from "./prompts/coach";

export interface CoachAgentOptions {
  tools: ToolsInput;
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
    model: opts.model,
    tools: opts.tools,
    memory: opts.memory,
  });
}
