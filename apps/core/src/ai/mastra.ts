import { Mastra } from "@mastra/core";
import { chatRoute } from "@mastra/ai-sdk";
import { MastraAuthBetterAuth } from "@mastra/auth-better-auth";
import type { Agent } from "@mastra/core/agent";
import type { PostgresStore } from "@mastra/pg";
import { Observability } from "@mastra/observability";
import { SpanType } from "@mastra/core/observability";
import { LangSmithExporter } from "@mastra/langsmith";
import { auth } from "@consistent/auth";
import type { Auth } from "better-auth";
import { env } from "../env";

type MastraResourceContext = { user?: { id?: string }; id?: string };

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
            excludeSpanTypes: [SpanType.MODEL_CHUNK],
          },
        },
      })
    : undefined;

  return new Mastra({
    agents: { "consistent-coach": agent },
    storage: store,
    ...(observability ? { observability } : {}),
    server: {
      apiPrefix: "",
      auth: new MastraAuthBetterAuth({
        // Our `auth` is `Auth<typeof options>` — a narrower instantiation than
        // MastraAuthBetterAuth's expected unparameterized `Auth`. Widening
        // here is structural-only; the runtime instance is identical.
        auth: auth as Auth,
        protected: [/^\/chat\//],
        mapUserToResourceId: (u: MastraResourceContext) =>
          u?.user?.id ?? u?.id ?? null,
      }),
      apiRoutes: [
        {
          ...chatRoute({ path: "/chat/:agentId" }),
          requiresAuth: true,
        },
      ],
    },
  });
}
