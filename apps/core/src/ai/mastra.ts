import { Mastra } from "@mastra/core";
import { chatRoute } from "@mastra/ai-sdk";
import { MastraAuthBetterAuth } from "@mastra/auth-better-auth";
import type { Agent } from "@mastra/core/agent";
import type { PostgresStore } from "@mastra/pg";
import { auth } from "@consistent/auth";

export function createMastra(agent: Agent, store: PostgresStore): Mastra {
  return new Mastra({
    agents: { "consistent-coach": agent } as any,
    storage: store as any,
    server: {
      apiPrefix: "",
      auth: new MastraAuthBetterAuth({ auth: auth as any }) as any,
      apiRoutes: [chatRoute({ path: "/chat/:agentId" })],
    } as any,
  });
}
