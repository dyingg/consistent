import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { Application } from "express";
import { MastraServer } from "@mastra/express";
import type { Mastra } from "@mastra/core";
import type { PostgresStore } from "@mastra/pg";
import { chatMemoryGuard } from "./ai.middleware";

export const MASTRA = Symbol("MASTRA");
export const STORE = Symbol("STORE");

@Injectable()
export class MastraBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(MastraBootstrap.name);

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    @Inject(MASTRA) private readonly mastra: Mastra,
    @Inject(STORE) private readonly store: PostgresStore,
  ) {}

  async onApplicationBootstrap() {
    await this.store.init();
    this.logger.log("Mastra storage initialized (schema: mastra)");

    const express =
      this.httpAdapterHost.httpAdapter.getInstance() as Application;

    express.use("/chat", chatMemoryGuard);

    const server = new MastraServer({
      app: express,
      mastra: this.mastra,
    });
    await server.init();

    this.logger.log("Mastra chat routes mounted at /chat/*");
  }
}
