import { Inject, Injectable } from "@nestjs/common";
import { eq, and } from "drizzle-orm";
import { goals } from "@consistent/db/schema";
import { DRIZZLE, type DrizzleDB } from "../db";

@Injectable()
export class GoalsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async findByUserId(userId: string, status?: string) {
    const conditions = [eq(goals.userId, userId)];
    if (status) {
      conditions.push(eq(goals.status, status as any));
    }
    return this.db
      .select()
      .from(goals)
      .where(and(...conditions));
  }

  async findById(id: number) {
    const rows = await this.db
      .select()
      .from(goals)
      .where(eq(goals.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(data: typeof goals.$inferInsert) {
    const rows = await this.db.insert(goals).values(data).returning();
    return rows[0]!;
  }

  async update(id: number, data: Partial<typeof goals.$inferInsert>) {
    const rows = await this.db
      .update(goals)
      .set(data)
      .where(eq(goals.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async delete(id: number) {
    const rows = await this.db
      .delete(goals)
      .where(eq(goals.id, id))
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Returns goal progress from denormalized columns.
   * No COUNT queries — single PK lookup.
   */
  async getProgress(goalId: number) {
    const goal = await this.findById(goalId);
    if (!goal) return null;
    return {
      total: goal.totalTasks,
      completed: goal.completedTasks,
      pct:
        goal.totalTasks > 0
          ? Math.round((goal.completedTasks / goal.totalTasks) * 100)
          : 0,
    };
  }
}
