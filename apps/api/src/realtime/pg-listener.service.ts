import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { Client } from "pg";
import { PG_CHANNELS } from "@consistent/realtime";
import { env } from "../env";

@Injectable()
export class PgListenerService implements OnModuleInit, OnModuleDestroy {
  private client: Client;
  private logger = new Logger(PgListenerService.name);

  async onModuleInit() {
    this.client = new Client({ connectionString: env.DATABASE_URL });

    try {
      await this.client.connect();
      await this.client.query(
        `LISTEN ${PG_CHANNELS.REALTIME_EVENTS}`,
      );

      this.client.on("notification", (msg) => {
        this.logger.debug(
          `PG notification on ${msg.channel}: ${msg.payload}`,
        );
      });

      this.logger.log(
        `Listening on Postgres channel: ${PG_CHANNELS.REALTIME_EVENTS}`,
      );
    } catch (err) {
      this.logger.error("Failed to connect pg listener", err);
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.end();
    }
  }
}
