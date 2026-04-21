import { Inject, Injectable } from "@nestjs/common";
import { eq, and, inArray, notInArray, desc, sql } from "drizzle-orm";
import { goals, scheduledBlocks, tasks } from "@consistent/db/schema";
import { DRIZZLE, type DrizzleDB } from "../db";

@Injectable()
export class TasksRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async findByGoalId(goalId: number) {
    return this.db.select().from(tasks).where(eq(tasks.goalId, goalId));
  }

  async findById(id: number) {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);
    return rows.at(0) ?? null;
  }

  async findByIds(ids: number[]) {
    if (!ids.length) return [];
    return this.db.select().from(tasks).where(inArray(tasks.id, ids));
  }

  async create(data: typeof tasks.$inferInsert) {
    const rows = await this.db.insert(tasks).values(data).returning();
    return rows[0]!;
  }

  async update(id: number, data: Partial<typeof tasks.$inferInsert>) {
    const rows = await this.db
      .update(tasks)
      .set(data)
      .where(eq(tasks.id, id))
      .returning();
    return rows.at(0) ?? null;
  }

  async delete(id: number) {
    const rows = await this.db
      .delete(tasks)
      .where(eq(tasks.id, id))
      .returning();
    return rows.at(0) ?? null;
  }

  async deleteMany(ids: number[]) {
    if (!ids.length) return [];
    return this.db
      .delete(tasks)
      .where(inArray(tasks.id, ids))
      .returning();
  }

  /**
   * Paginated "all tasks" view, joined with the task's goal and the earliest
   * scheduled block. Cancelled tasks are excluded; completed tasks are kept
   * so the view works as a full task log. Ordered so unscheduled tasks
   * (NULL earliest_block) surface first, then scheduled tasks ascending by
   * their next block; within each group, completed tasks sink to the bottom
   * so pending work stays visible. Newest-created wins final ties.
   */
  async findAllForUserPaginated(
    userId: string,
    limit: number,
    offset: number,
  ) {
    const earliestBlock = sql<string | null>`(
      SELECT MIN(${scheduledBlocks.startTime})
      FROM ${scheduledBlocks}
      WHERE ${scheduledBlocks.taskId} = ${tasks.id}
    )`.as("earliest_block");

    return this.db
      .select({
        id: tasks.id,
        goalId: tasks.goalId,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        priority: tasks.priority,
        estimatedMinutes: tasks.estimatedMinutes,
        deadline: tasks.deadline,
        createdAt: tasks.createdAt,
        earliestBlockStart: earliestBlock,
        goal: {
          id: goals.id,
          title: goals.title,
          color: goals.color,
        },
      })
      .from(tasks)
      .innerJoin(goals, eq(goals.id, tasks.goalId))
      .where(
        and(
          eq(tasks.userId, userId),
          notInArray(tasks.status, ["cancelled"]),
        ),
      )
      .orderBy(
        sql`${earliestBlock} ASC NULLS FIRST`,
        sql`CASE WHEN ${tasks.status} = 'completed' THEN 1 ELSE 0 END ASC`,
        desc(tasks.createdAt),
      )
      .limit(limit)
      .offset(offset);
  }

  /**
   * Find tasks for a user that have no blockers and are pending.
   * Hits the partial index idx_tasks_ready.
   */
  async findReadyForUser(userId: string) {
    return this.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.blockerCount, 0),
          eq(tasks.status, "pending"),
        ),
      );
  }

  /**
   * Get all tasks and their dependency structure for a goal as a DAG.
   * Uses a recursive CTE to traverse from root tasks (no prerequisites).
   */
  async getGoalDag(goalId: number) {
    return this.db.execute(sql`
      WITH RECURSIVE goal_dag AS (
        SELECT t.*, 0 AS depth FROM tasks t
        WHERE t.goal_id = ${goalId} AND NOT EXISTS (
          SELECT 1 FROM task_dependencies d WHERE d.task_id = t.id
        )
        UNION ALL
        SELECT t.*, g.depth + 1 FROM tasks t
        JOIN task_dependencies d ON d.task_id = t.id
        JOIN goal_dag g ON g.id = d.depends_on_id
      )
      SELECT * FROM goal_dag;
    `);
  }
}
