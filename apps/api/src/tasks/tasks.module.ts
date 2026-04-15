import { Module } from "@nestjs/common";
import { TasksRepository } from "./tasks.repository";
import { DependenciesRepository } from "./dependencies.repository";

@Module({
  providers: [TasksRepository, DependenciesRepository],
  exports: [TasksRepository, DependenciesRepository],
})
export class TasksModule {}
