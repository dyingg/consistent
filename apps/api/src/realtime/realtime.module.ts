import { Module } from "@nestjs/common";
import { RealtimeGateway } from "./realtime.gateway";
import { PgListenerService } from "./pg-listener.service";
import { RedisPubSubService } from "./redis-pubsub.service";

@Module({
  providers: [RealtimeGateway, PgListenerService, RedisPubSubService],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
