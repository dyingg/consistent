import type { Provider } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@consistent/db/schema";
import { env } from "../env";
import { DRIZZLE } from "./types";

export const DrizzleProvider: Provider = {
  provide: DRIZZLE,
  useFactory: () => {
    const pool = new Pool({
      connectionString: env.DATABASE_URL,
    });
    return drizzle(pool, { schema });
  },
};
