import { Module } from "@nestjs/common";
import { TasksModule } from "../tasks/tasks.module";
import { SchedulingRepository } from "./scheduling.repository";
import { SchedulingService } from "./scheduling.service";
import { SchedulingController } from "./scheduling.controller";

@Module({
  imports: [TasksModule],
  controllers: [SchedulingController],
  providers: [SchedulingService, SchedulingRepository],
  exports: [SchedulingService, SchedulingRepository],
})
export class SchedulingModule {}
