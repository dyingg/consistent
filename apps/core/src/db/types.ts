import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@consistent/db/schema";

export const DRIZZLE = Symbol("DRIZZLE");
export type DrizzleDB = NodePgDatabase<typeof schema>;
