export { auth } from "./auth.js";

// Better Auth's `$Infer.Session` returns `{ session, user }` based on the
// configured plugins, schema, and additionalFields. Re-exporting these as
// concrete type aliases lets the API type `@CurrentUser()`, `req.user`, and
// service method signatures without leaking `auth.$Infer` plumbing.
import type { auth } from "./auth.js";

export type AuthSession = typeof auth.$Infer.Session;
export type AuthUser = AuthSession["user"];
