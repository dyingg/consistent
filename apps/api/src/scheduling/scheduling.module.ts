import { Module } from "@nestjs/common";
import { SchedulingRepository } from "./scheduling.repository";

@Module({
  providers: [SchedulingRepository],
  exports: [SchedulingRepository],
})
export class SchedulingModule {}
