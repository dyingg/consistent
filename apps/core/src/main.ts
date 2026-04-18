import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { AuthenticatedIoAdapter } from "./realtime/realtime.adapter";
import { configureApp } from "./bootstrap";
import { env } from "./env";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  configureApp(app);

  app.useWebSocketAdapter(new AuthenticatedIoAdapter(app));

  await app.listen(env.PORT, "0.0.0.0");
  console.log(`API running on http://localhost:${env.PORT}`);
}

bootstrap();
