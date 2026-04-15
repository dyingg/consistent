import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { GoalsRepository } from "./goals.repository";
import { GoalsService } from "./goals.service";
import { GoalsController } from "./goals.controller";

@Module({
  imports: [RealtimeModule],
  controllers: [GoalsController],
  providers: [GoalsService, GoalsRepository],
  exports: [GoalsService, GoalsRepository],
})
export class GoalsModule {}
