import { VersioningType } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "@consistent/auth";
import express, {
  type Application,
  type Request as ExpressRequest,
  type Response as ExpressResponse,
} from "express";
import { env } from "./env";

/**
 * Applies the cross-cutting bootstrap that both production (main.ts) and
 * e2e tests need: URI versioning, CORS, and the Better Auth route mount.
 *
 * Kept out of main.ts so test/auth.e2e-spec.ts can call exactly the same
 * setup against an in-memory NestJS app — guaranteeing the test exercises
 * the real wiring (including the body-parser ordering on the auth route).
 */
export function configureApp(app: NestExpressApplication): void {
  app.enableVersioning({ type: VersioningType.URI });

  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  // NestFactory.create() doesn't run app.init() — that happens during
  // listen()/init(), so the global body-parser registered by NestJS lands
  // AFTER this route in Express's middleware stack. Attach express.json()
  // directly to the route so req.body is parsed regardless of when NestJS's
  // parser registers.
  // NestJS's http adapter is typed against an older @types/express-serve-static-core
  // than the one resolved here, so a direct cast fails on Response.cookie's v5
  // signature. Bridge through unknown: the runtime object is a real express app.
  const expressApp = app
    .getHttpAdapter()
    .getInstance() as unknown as Application;

  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Better Auth handler is async
  expressApp.all(
    "/api/auth/*splat",
    express.json(),
    async (req: ExpressRequest, res: ExpressResponse) => {
      const url = new URL(req.originalUrl, `http://${req.headers.host}`);
      const headers = fromNodeHeaders(req.headers);
      const bodyStr =
        typeof req.body === "string"
          ? req.body
          : req.body
            ? JSON.stringify(req.body)
            : undefined;

      const webRequest = new Request(url.toString(), {
        method: req.method,
        headers,
        ...(bodyStr ? { body: bodyStr } : {}),
      });

      const response = await auth.handler(webRequest);
      res.status(response.status);
      response.headers.forEach((value: string, key: string) => {
        res.set(key, value);
      });
      const text = await response.text();
      res.send(text || null);
    },
  );
}
