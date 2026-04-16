import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { VersioningType } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "@consistent/auth";
import { AppModule } from "./app.module";
import { AuthenticatedIoAdapter } from "./realtime/realtime.adapter";
import { env } from "./env";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.enableVersioning({ type: VersioningType.URI });

  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  // Mount Better Auth on Express
  const express = app.getHttpAdapter().getInstance();

  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Better Auth handler is async
  (express as any).all("/api/auth/*splat", async (req: ExpressRequest, res: ExpressResponse) => {
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
  });

  app.useWebSocketAdapter(new AuthenticatedIoAdapter(app));

  await app.listen(env.PORT, "0.0.0.0");
  console.log(`API running on http://localhost:${env.PORT}`);
}

bootstrap();
