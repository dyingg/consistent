import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { AuthUser } from "@consistent/auth";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/auth.decorator";
import { GoalsService } from "./goals.service";
import type { CreateGoalInput, UpdateGoalInput } from "./goals.service";

@Controller({ version: "1" })
@UseGuards(AuthGuard)
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @Post("goals")
  create(@CurrentUser() user: AuthUser, @Body() body: CreateGoalInput) {
    return this.goalsService.create(user.id, body);
  }

  @Get("goals")
  findAll(@CurrentUser() user: AuthUser, @Query("status") status?: string) {
    return this.goalsService.findAll(user.id, status);
  }

  @Get("goals/:id")
  findOne(@CurrentUser() user: AuthUser, @Param("id", ParseIntPipe) id: number) {
    return this.goalsService.findById(user.id, id);
  }

  @Patch("goals/:id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() body: UpdateGoalInput,
  ) {
    return this.goalsService.update(user.id, id, body);
  }

  @Delete("goals/:id")
  remove(@CurrentUser() user: AuthUser, @Param("id", ParseIntPipe) id: number) {
    return this.goalsService.delete(user.id, id);
  }

  @Get("goals/:id/progress")
  getProgress(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.goalsService.getProgress(user.id, id);
  }
}
