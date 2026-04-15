import { Inject, Injectable } from "@nestjs/common";
import { eq, and, gte, lte } from "drizzle-orm";
import { scheduleRuns, scheduledBlocks } from "@consistent/db/schema";
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
}
