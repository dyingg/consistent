import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/auth.decorator";
import { TasksService } from "./tasks.service";
import type {
  CreateTaskInput,
  UpdateTaskInput,
  BulkCreateInput,
} from "./tasks.service";

@Controller({ version: "1" })
@UseGuards(AuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post("goals/:goalId/tasks")
  create(
    @CurrentUser() user: any,
    @Param("goalId", ParseIntPipe) goalId: number,
    @Body() body: CreateTaskInput,
  ) {
    return this.tasksService.create(user.id, goalId, body);
  }

  @Post("goals/:goalId/tasks/bulk")
  bulkCreate(
    @CurrentUser() user: any,
    @Param("goalId", ParseIntPipe) goalId: number,
    @Body() body: BulkCreateInput,
  ) {
    return this.tasksService.bulkCreate(user.id, goalId, body);
  }

  @Get("goals/:goalId/tasks")
  findAllForGoal(
    @CurrentUser() user: any,
    @Param("goalId", ParseIntPipe) goalId: number,
  ) {
    return this.tasksService.findAllForGoal(user.id, goalId);
  }

  @Get("goals/:goalId/dag")
  getGoalDag(
    @CurrentUser() user: any,
    @Param("goalId", ParseIntPipe) goalId: number,
  ) {
    return this.tasksService.getGoalDag(user.id, goalId);
  }

  // Static route before parameterized :id route
  @Get("tasks/ready")
  findReady(@CurrentUser() user: any) {
    return this.tasksService.findReadyForUser(user.id);
  }

  @Get("tasks/:id")
  findOne(@CurrentUser() user: any, @Param("id", ParseIntPipe) id: number) {
    return this.tasksService.findById(user.id, id);
  }

  @Patch("tasks/:id")
  update(
    @CurrentUser() user: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() body: UpdateTaskInput,
  ) {
    return this.tasksService.update(user.id, id, body);
  }

  @Delete("tasks/:id")
  remove(@CurrentUser() user: any, @Param("id", ParseIntPipe) id: number) {
    return this.tasksService.delete(user.id, id);
  }

  @Post("tasks/:id/dependencies")
  addDependency(
    @CurrentUser() user: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() body: { dependsOnId: number; type?: string; lagMinutes?: number },
  ) {
    return this.tasksService.addDependency(
      user.id,
      id,
      body.dependsOnId,
      body.type,
      body.lagMinutes,
    );
  }

  @Delete("tasks/:id/dependencies/:dependsOnId")
  removeDependency(
    @CurrentUser() user: any,
    @Param("id", ParseIntPipe) id: number,
    @Param("dependsOnId", ParseIntPipe) dependsOnId: number,
  ) {
    return this.tasksService.removeDependency(user.id, id, dependsOnId);
  }
}
