import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { Application } from "express";
import { MastraServer } from "@mastra/express";
import type { Mastra } from "@mastra/core";
import type { PostgresStore } from "@mastra/pg";

export const MASTRA = Symbol("MASTRA");
export const STORE = Symbol("STORE");

@Injectable()
export class MastraBootstrap implements OnModuleInit {
  private readonly logger = new Logger(MastraBootstrap.name);

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    @Inject(MASTRA) private readonly mastra: Mastra,
    @Inject(STORE) private readonly store: PostgresStore,
  ) {}

  /**
   * Use OnModuleInit (not OnApplicationBootstrap) because NestJS registers its
   * controllers during the module-init phase; onApplicationBootstrap runs after
   * routing has been finalized, so middleware added there lands after NestJS's
   * default 404 handler and never fires on unmatched paths.
   */
  async onModuleInit() {
    await this.store.init();
    this.logger.log("Mastra storage initialized (schema: mastra)");

    const express =
      this.httpAdapterHost.httpAdapter.getInstance() as Application;

    // Express adapter gates custom-route auth on this Map (route key "METHOD:path").
    // requiresAuth on the route config alone isn't enough in the current version.
    const customRouteAuthConfig = new Map<string, boolean>([
      ["POST:/chat/:agentId", true],
    ]);
    const server = new MastraServer({
      app: express,
      mastra: this.mastra,
      customRouteAuthConfig,
    });
    await server.init();

    this.logger.log("Mastra chat routes mounted at /chat/*");
  }
}
