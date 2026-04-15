import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { Redis } from "ioredis";
import { REDIS_CHANNELS } from "@consistent/realtime";
import { env } from "../env";

@Injectable()
export class RedisPubSubService implements OnModuleInit, OnModuleDestroy {
  private subscriber: Redis;
  private publisher: Redis;
  private logger = new Logger(RedisPubSubService.name);

  async onModuleInit() {
    this.subscriber = new Redis(env.REDIS_URL);
    this.publisher = new Redis(env.REDIS_URL);

    await this.subscriber.subscribe(REDIS_CHANNELS.REALTIME_EVENTS);

    this.subscriber.on("message", (channel: string, message: string) => {
      this.logger.debug(`Redis message on ${channel}: ${message}`);
    });

    this.logger.log(
      `Subscribed to Redis channel: ${REDIS_CHANNELS.REALTIME_EVENTS}`,
    );
  }

  async publish(channel: string, message: string) {
    await this.publisher.publish(channel, message);
  }

  async onModuleDestroy() {
    if (this.subscriber) await this.subscriber.quit();
    if (this.publisher) await this.publisher.quit();
  }
}
