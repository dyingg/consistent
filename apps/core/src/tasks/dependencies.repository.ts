import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { eq, and } from "drizzle-orm";
import { taskDependencies } from "@consistent/db/schema";
import { DRIZZLE, type DrizzleDB } from "../db";

@Injectable()
export class DependenciesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /**
   * Create a dependency edge. The `prevent_cycle` database trigger will raise
   * a PostgreSQL check_violation error if the edge would create a cycle.
   * This is caught and rethrown as a NestJS BadRequestException.
   */
  async create(data: typeof taskDependencies.$inferInsert) {
    try {
      const rows = await this.db
        .insert(taskDependencies)
        .values(data)
        .returning();
      return rows[0]!;
    } catch (error: unknown) {
      const pgError = error as { code?: string; message?: string };
      if (
        pgError.code === "23514" ||
        pgError.message?.includes("cycle detected")
      ) {
        throw new BadRequestException(
          "Adding this dependency would create a circular dependency",
        );
      }
      throw error;
    }
  }

  async findByTaskId(taskId: number) {
    return this.db
      .select()
      .from(taskDependencies)
      .where(eq(taskDependencies.taskId, taskId));
  }

  async findByDependsOnId(dependsOnId: number) {
    return this.db
      .select()
      .from(taskDependencies)
      .where(eq(taskDependencies.dependsOnId, dependsOnId));
  }

  async delete(taskId: number, dependsOnId: number) {
    const rows = await this.db
      .delete(taskDependencies)
      .where(
        and(
          eq(taskDependencies.taskId, taskId),
          eq(taskDependencies.dependsOnId, dependsOnId),
        ),
      )
      .returning();
    return rows.at(0) ?? null;
  }
}
