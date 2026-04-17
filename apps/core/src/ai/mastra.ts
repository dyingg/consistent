import { Mastra } from "@mastra/core";
import { chatRoute } from "@mastra/ai-sdk";
import { MastraAuthBetterAuth } from "@mastra/auth-better-auth";
import type { Agent } from "@mastra/core/agent";
import type { PostgresStore } from "@mastra/pg";
import { Observability } from "@mastra/observability";
import { LangSmithExporter } from "@mastra/langsmith";
import { auth } from "@consistent/auth";
import { env } from "../env";

export function createMastra(agent: Agent, store: PostgresStore): Mastra {
  const observability = env.LANGSMITH_API_KEY
    ? new Observability({
        configs: {
          langsmith: {
            serviceName: "consistent-coach",
            exporters: [
              new LangSmithExporter({
                apiKey: env.LANGSMITH_API_KEY,
                apiUrl: env.LANGSMITH_ENDPOINT,
                projectName: env.LANGSMITH_PROJECT,
              }),
            ],
          },
        },
      })
    : undefined;

  return new Mastra({
    agents: { "consistent-coach": agent } as any,
    storage: store as any,
    ...(observability ? { observability: observability as any } : {}),
    server: {
      apiPrefix: "",
      auth: new MastraAuthBetterAuth({
        auth: auth as any,
        protected: [/^\/chat\//],
        mapUserToResourceId: (u: any) => u?.user?.id ?? u?.id ?? null,
      } as any) as any,
      apiRoutes: [
        {
          ...chatRoute({ path: "/chat/:agentId" }),
          requiresAuth: true,
        },
      ],
    } as any,
  });
}
