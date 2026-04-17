import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { user, type UserPreferences } from "@consistent/db/schema";
import { DRIZZLE, type DrizzleDB } from "../db";

@Injectable()
export class UsersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async findById(id: string) {
    const rows = await this.db
      .select()
      .from(user)
      .where(eq(user.id, id))
      .limit(1);
    return rows.at(0) ?? null;
  }

  async findByEmail(email: string) {
    const rows = await this.db
      .select()
      .from(user)
      .where(eq(user.email, email))
      .limit(1);
    return rows.at(0) ?? null;
  }

  async updatePreferences(id: string, preferences: Partial<UserPreferences>) {
    const rows = await this.db
      .update(user)
      .set({ preferences })
      .where(eq(user.id, id))
      .returning();
    return rows.at(0) ?? null;
  }

  async updateTimezone(id: string, timezone: string) {
    const rows = await this.db
      .update(user)
      .set({ timezone })
      .where(eq(user.id, id))
      .returning();
    return rows.at(0) ?? null;
  }
}
