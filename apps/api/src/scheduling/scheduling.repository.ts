import { Inject, Injectable } from "@nestjs/common";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import {
  scheduleRuns,
  scheduledBlocks,
  tasks,
  goals,
} from "@consistent/db/schema";
import { DRIZZLE, type DrizzleDB } from "../db";

@Injectable()
export class SchedulingRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async createRun(data: typeof scheduleRuns.$inferInsert) {
    const rows = await this.db.insert(scheduleRuns).values(data).returning();
    return rows[0]!;
  }

  async createBlock(data: typeof scheduledBlocks.$inferInsert) {
    const rows = await this.db
      .insert(scheduledBlocks)
      .values(data)
      .returning();
    return rows[0]!;
  }

  async getBlocksForRange(userId: string, start: Date, end: Date) {
    return this.db
      .select()
      .from(scheduledBlocks)
      .where(
        and(
          eq(scheduledBlocks.userId, userId),
          gte(scheduledBlocks.startTime, start),
          lte(scheduledBlocks.endTime, end),
        ),
      );
  }

  async updateBlockStatus(
    id: number,
    status: "planned" | "confirmed" | "completed" | "missed" | "moved",
  ) {
    const rows = await this.db
      .update(scheduledBlocks)
      .set({ status })
      .where(eq(scheduledBlocks.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async findBlockById(id: number) {
    const rows = await this.db
      .select()
      .from(scheduledBlocks)
      .where(eq(scheduledBlocks.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async deleteBlock(id: number) {
    const rows = await this.db
      .delete(scheduledBlocks)
      .where(eq(scheduledBlocks.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async getBlocksForRangeWithDetails(
    userId: string,
    start: Date,
    end: Date,
  ) {
    return this.db
      .select({
        id: scheduledBlocks.id,
        taskId: scheduledBlocks.taskId,
        startTime: scheduledBlocks.startTime,
        endTime: scheduledBlocks.endTime,
        status: scheduledBlocks.status,
        scheduledBy: scheduledBlocks.scheduledBy,
        createdAt: scheduledBlocks.createdAt,
        task: {
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          goalId: tasks.goalId,
        },
        goal: {
          id: goals.id,
          title: goals.title,
          color: goals.color,
        },
      })
      .from(scheduledBlocks)
      .innerJoin(tasks, eq(scheduledBlocks.taskId, tasks.id))
      .innerJoin(goals, eq(tasks.goalId, goals.id))
      .where(
        and(
          eq(scheduledBlocks.userId, userId),
          gte(scheduledBlocks.startTime, start),
          lte(scheduledBlocks.endTime, end),
        ),
      );
  }

  async getCurrentBlock(userId: string) {
    const now = new Date();
    const rows = await this.db
      .select({
        id: scheduledBlocks.id,
        taskId: scheduledBlocks.taskId,
        startTime: scheduledBlocks.startTime,
        endTime: scheduledBlocks.endTime,
        status: scheduledBlocks.status,
        scheduledBy: scheduledBlocks.scheduledBy,
        createdAt: scheduledBlocks.createdAt,
        task: {
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          goalId: tasks.goalId,
        },
        goal: {
          id: goals.id,
          title: goals.title,
          color: goals.color,
        },
      })
      .from(scheduledBlocks)
      .innerJoin(tasks, eq(scheduledBlocks.taskId, tasks.id))
      .innerJoin(goals, eq(tasks.goalId, goals.id))
      .where(
        and(
          eq(scheduledBlocks.userId, userId),
          lte(scheduledBlocks.startTime, now),
          gte(scheduledBlocks.endTime, now),
        ),
      )
      .orderBy(desc(scheduledBlocks.startTime))
      .limit(1);
    return rows[0] ?? null;
  }
}
