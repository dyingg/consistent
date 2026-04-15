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
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/auth.decorator";
import { SchedulingService } from "./scheduling.service";
import type { CreateBlockInput } from "./scheduling.service";

@Controller({ version: "1" })
@UseGuards(AuthGuard)
export class SchedulingController {
  constructor(private readonly schedulingService: SchedulingService) {}

  @Post("schedule/blocks")
  createBlock(@CurrentUser() user: any, @Body() body: CreateBlockInput) {
    return this.schedulingService.createBlock(user.id, body);
  }

  @Get("schedule/blocks")
  getBlocks(
    @CurrentUser() user: any,
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
  getCurrentBlock(@CurrentUser() user: any) {
    return this.schedulingService.getCurrentBlock(user.id);
  }

  @Patch("schedule/blocks/:id")
  updateStatus(
    @CurrentUser() user: any,
    @Param("id", ParseIntPipe) id: number,
    @Body()
    body: {
      status: "planned" | "confirmed" | "completed" | "missed" | "moved";
    },
  ) {
    return this.schedulingService.updateBlockStatus(user.id, id, body.status);
  }

  @Delete("schedule/blocks/:id")
  deleteBlock(
    @CurrentUser() user: any,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.schedulingService.deleteBlock(user.id, id);
  }
}
