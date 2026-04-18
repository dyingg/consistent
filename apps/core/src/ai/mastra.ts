import { Mastra } from "@mastra/core";
import { chatRoute } from "@mastra/ai-sdk";
import { MastraAuthBetterAuth } from "@mastra/auth-better-auth";
import type { Agent } from "@mastra/core/agent";
import type { PostgresStore } from "@mastra/pg";
import { Observability } from "@mastra/observability";
import { LangSmithExporter } from "@mastra/langsmith";
import { auth } from "@consistent/auth";
import { env } from "../env";

/**
 * Mastra's public types are notoriously narrow — `agents`, `storage`,
 * `observability`, and the `server` block all expect concrete generic
 * parameters that aren't exported, even though the runtime accepts the
 * shapes we're passing. The eslint-disable lines below are localized to
 * the bridges we don't own. If Mastra publishes accurate types, drop them.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Mastra's public types are narrower than the runtime contract; localized to this factory */

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
        mapUserToResourceId: (u: MastraResourceContext) =>
          u?.user?.id ?? u?.id ?? null,
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
/* eslint-enable @typescript-eslint/no-explicit-any */
