import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@consistent/db";
import * as schema from "@consistent/db/schema";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  trustedOrigins: process.env.WEB_ORIGIN
    ? [process.env.WEB_ORIGIN]
    : ["http://localhost:3000"],
});
