import {
  BadRequestException,
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
import { SchedulingService } from "./scheduling.service";
import type { CreateBlockInput } from "./scheduling.service";

@Controller({ version: "1" })
@UseGuards(AuthGuard)
export class SchedulingController {
  constructor(private readonly schedulingService: SchedulingService) {}

  @Post("schedule/blocks")
  createBlock(@CurrentUser() user: AuthUser, @Body() body: CreateBlockInput) {
    return this.schedulingService.createBlock(user.id, body);
  }

  @Get("schedule/blocks")
  getBlocks(
    @CurrentUser() user: AuthUser,
    @Query("start") start: string,
    @Query("end") end: string,
  ) {
    const startDate = new Date(start);
    const endDate = new Date(end);

    if (isNaN(startDate.getTime())) {
      throw new BadRequestException("Invalid start date format");
    }
    if (isNaN(endDate.getTime())) {
      throw new BadRequestException("Invalid end date format");
    }

    return this.schedulingService.getBlocksForRange(
      user.id,
      startDate,
      endDate,
    );
  }

  @Get("schedule/now")
  getCurrentBlock(@CurrentUser() user: AuthUser) {
    return this.schedulingService.getCurrentBlock(user.id);
  }

  @Patch("schedule/blocks/:id")
  updateBlock(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseIntPipe) id: number,
    @Body()
    body: {
      status?: "planned" | "confirmed" | "completed" | "missed" | "moved";
      startTime?: string;
      endTime?: string;
      taskId?: number;
    },
  ) {
    const patch: Parameters<SchedulingService["updateBlock"]>[2] = {};
    if (body.status !== undefined) patch.status = body.status;
    if (body.taskId !== undefined) patch.taskId = body.taskId;
    if (body.startTime !== undefined) {
      const d = new Date(body.startTime);
      if (isNaN(d.getTime())) {
        throw new BadRequestException("Invalid startTime format");
      }
      patch.startTime = d;
    }
    if (body.endTime !== undefined) {
      const d = new Date(body.endTime);
      if (isNaN(d.getTime())) {
        throw new BadRequestException("Invalid endTime format");
      }
      patch.endTime = d;
    }
    return this.schedulingService.updateBlock(user.id, id, patch);
  }

  @Post("schedule/blocks/shift")
  shift(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      deltaMinutes: number;
      blockIds?: number[];
      afterTime?: string;
    },
  ) {
    if (typeof body.deltaMinutes !== "number") {
      throw new BadRequestException("deltaMinutes is required");
    }
    if ((body.blockIds && body.afterTime) || (!body.blockIds && !body.afterTime)) {
      throw new BadRequestException(
        "Provide exactly one of blockIds or afterTime",
      );
    }
    if (body.blockIds) {
      return this.schedulingService.shiftBlocks(user.id, {
        blockIds: body.blockIds,
        deltaMinutes: body.deltaMinutes,
      });
    }
    const d = new Date(body.afterTime!);
    if (isNaN(d.getTime())) {
      throw new BadRequestException("Invalid afterTime format");
    }
    return this.schedulingService.shiftBlocks(user.id, {
      afterTime: d,
      deltaMinutes: body.deltaMinutes,
    });
  }

  @Delete("schedule/blocks/:id")
  deleteBlock(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.schedulingService.deleteBlock(user.id, id);
  }
}
