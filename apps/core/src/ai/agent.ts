import { Agent } from "@mastra/core/agent";
import type { Memory } from "@mastra/memory";
import { COACH_SYSTEM_PROMPT } from "./prompts/coach";

export interface CoachAgentOptions {
  tools: Record<string, unknown>;
  memory: Memory;
  model: string;
}

export function createCoachAgent(opts: CoachAgentOptions): Agent {
  return new Agent({
    id: "consistent-coach",
    name: "Consistent Coach",
    instructions: COACH_SYSTEM_PROMPT,
    model: opts.model as any,
    tools: opts.tools as any,
    memory: opts.memory,
  });
}
