import { Controller, Get, Inject } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { DRIZZLE, type DrizzleDB } from "../db";
import { env } from "../env";

@Controller({ version: "1" })
export class HealthController {
  private redis: Redis;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {
    this.redis = new Redis(env.REDIS_URL);
  }

  @Get("health")
  async check() {
    let dbStatus: "ok" | "error" = "error";
    let redisStatus: "ok" | "error" = "error";

    try {
      await this.db.execute(sql`SELECT 1`);
      dbStatus = "ok";
    } catch {
      // db unreachable
    }

    try {
      await this.redis.ping();
      redisStatus = "ok";
    } catch {
      // redis unreachable
    }

    const status =
      dbStatus === "ok" && redisStatus === "ok" ? "ok" : "degraded";

    return { status, db: dbStatus, redis: redisStatus };
  }
}
