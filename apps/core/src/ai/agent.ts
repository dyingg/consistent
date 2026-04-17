import { Agent } from "@mastra/core/agent";
import type { Memory } from "@mastra/memory";
import { COACH_SYSTEM_PROMPT } from "./prompts/coach";

export interface CoachAgentOptions {
  tools: Record<string, unknown>;
  memory: Memory;
  model: string;
}

/**
 * Build the per-request instructions. The language model has a knowledge
 * cutoff and no inherent sense of "now", so we inject the real clock every
 * turn. Dates/times are in UTC; ask the user for their timezone if needed.
 */
function buildInstructions(): string {
  const now = new Date();
  const isoDate = now.toISOString().slice(0, 10);
  const weekday = now.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
  const timeUtc = now.toISOString().slice(11, 16);
  const clock = `Today is ${weekday}, ${isoDate} (UTC ${timeUtc}). If the user references a day/time, assume UTC unless they tell you their timezone.`;
  return `${clock}\n\n${COACH_SYSTEM_PROMPT}`;
}

export function createCoachAgent(opts: CoachAgentOptions): Agent {
  return new Agent({
    id: "consistent-coach",
    name: "Consistent Coach",
    instructions: () => buildInstructions(),
    model: opts.model as any,
    tools: opts.tools as any,
    memory: opts.memory,
  });
}
