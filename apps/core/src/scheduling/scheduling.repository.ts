import { Inject, Injectable } from "@nestjs/common";
import { eq, and, gte, lte, lt, gt, desc, asc, notInArray, sql } from "drizzle-orm";
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

  async updateBlock(
    id: number,
    patch: Partial<
      Pick<
        typeof scheduledBlocks.$inferInsert,
        "status" | "startTime" | "endTime" | "taskId"
      >
    >,
  ) {
    const rows = await this.db
      .update(scheduledBlocks)
      .set(patch)
      .where(eq(scheduledBlocks.id, id))
      .returning();
    return rows.at(0) ?? null;
  }

  async shiftBlocks(ids: number[], deltaMinutes: number) {
    if (ids.length === 0) return [];
    return this.db.transaction(async (tx) => {
      const rows: Array<typeof scheduledBlocks.$inferSelect> = [];
      for (const id of ids) {
        const updated = await tx
          .update(scheduledBlocks)
          .set({
            startTime: sql`${scheduledBlocks.startTime} + make_interval(mins => ${deltaMinutes})`,
            endTime: sql`${scheduledBlocks.endTime} + make_interval(mins => ${deltaMinutes})`,
          })
          .where(eq(scheduledBlocks.id, id))
          .returning();
        if (updated.at(0)) rows.push(updated[0]!);
      }
      return rows;
    });
  }

  async findOverlapping(
    userId: string,
    start: Date,
    end: Date,
    excludeIds: number[] = [],
  ) {
    const conditions = [
      eq(scheduledBlocks.userId, userId),
      lt(scheduledBlocks.startTime, end),
      gt(scheduledBlocks.endTime, start),
    ];
    if (excludeIds.length > 0) {
      conditions.push(notInArray(scheduledBlocks.id, excludeIds));
    }
    return this.db
      .select()
      .from(scheduledBlocks)
      .where(and(...conditions));
  }

  async findBlockById(id: number) {
    const rows = await this.db
      .select()
      .from(scheduledBlocks)
      .where(eq(scheduledBlocks.id, id))
      .limit(1);
    return rows.at(0) ?? null;
  }

  async deleteBlock(id: number) {
    const rows = await this.db
      .delete(scheduledBlocks)
      .where(eq(scheduledBlocks.id, id))
      .returning();
    return rows.at(0) ?? null;
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
          description: tasks.description,
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
      )
      .orderBy(asc(scheduledBlocks.startTime));
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
          description: tasks.description,
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
    return rows.at(0) ?? null;
  }
}
