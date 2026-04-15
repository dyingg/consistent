import { Module } from "@nestjs/common";
import { GoalsModule } from "../goals/goals.module";
import { TasksRepository } from "./tasks.repository";
import { DependenciesRepository } from "./dependencies.repository";
import { TasksService } from "./tasks.service";
import { TasksController } from "./tasks.controller";

@Module({
  imports: [GoalsModule],
  controllers: [TasksController],
  providers: [TasksService, TasksRepository, DependenciesRepository],
  exports: [TasksService, TasksRepository, DependenciesRepository],
})
export class TasksModule {}
