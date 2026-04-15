import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "@consistent/auth";
import { AppModule } from "./app.module";
import { AuthenticatedIoAdapter } from "./realtime/realtime.adapter";
import { env } from "./env";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  app.enableVersioning({ type: VersioningType.URI });

  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
  });

  // Mount Better Auth on raw Fastify instance
  const fastify = app.getHttpAdapter().getInstance();

  fastify.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    handler: async (request: any, reply: any) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const headers = fromNodeHeaders(request.headers);
      const bodyStr =
        typeof request.body === "string"
          ? request.body
          : request.body
            ? JSON.stringify(request.body)
            : undefined;

      const webRequest = new Request(url.toString(), {
        method: request.method,
        headers,
        ...(bodyStr ? { body: bodyStr } : {}),
      });

      const response = await auth.handler(webRequest);
      reply.status(response.status);
      response.headers.forEach((value: string, key: string) => {
        reply.header(key, value);
      });
      const text = await response.text();
      reply.send(text || null);
    },
  });

  app.useWebSocketAdapter(new AuthenticatedIoAdapter(app));

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  console.log(`API running on http://localhost:${env.PORT}`);
}

bootstrap();
