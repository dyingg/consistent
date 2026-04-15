# @consistent/db

Drizzle ORM schema, migrations, and database client for the Consistent monorepo.

## Tables

| Table | PK | Description |
|-------|-----|-------------|
| `user` | text | Better Auth user + domain columns (`timezone`, `preferences`) |
| `session` | text | Better Auth sessions |
| `account` | text | Better Auth OAuth accounts |
| `verification` | text | Better Auth email verification |
| `goals` | bigserial | User goals with denormalized task counters |
| `tasks` | bigserial | Tasks within goals, with blocker count |
| `task_dependencies` | composite | DAG edges between tasks |
| `schedule_runs` | bigserial | LLM scheduling audit log |
| `scheduled_blocks` | bigserial | Calendar time blocks for tasks |

## Dependency Direction Convention

A row `(task_id=A, depends_on_id=B)` in `task_dependencies` means **"A depends on B"** — B must finish before A can start (for `finish_to_start` type).

## Denormalized Counters

- `goals.total_tasks` / `goals.completed_tasks` — maintained by the `update_goal_counters` trigger
- `tasks.blocker_count` — maintained by `update_blocker_counts` and `cascade_blocker_count` triggers

**Never use `COUNT(*)` queries to compute goal progress in application code.** Read the denormalized columns instead.

## Migration Workflow

### Schema changes (tables, columns, indexes, enums)

```bash
# 1. Edit schema files in src/schema/
# 2. Generate migration
pnpm db:generate

# 3. Review the generated SQL in drizzle/
# 4. Apply
pnpm db:migrate
```

### Custom SQL (triggers, functions, check constraints)

```bash
# 1. Create an empty custom migration
pnpm db:generate:custom --name=description

# 2. Write your SQL in the generated file
# 3. Apply
pnpm db:migrate
```

### What lives in custom migrations

These are **not auto-regenerated** by `drizzle-kit generate` — edit them by hand:

- **Triggers:** `set_updated_at`, `update_goal_counters`, `update_blocker_counts`, `cascade_blocker_count`, `prevent_cycle`
- **Functions:** `reconcile_counters()`
- **Partial index:** `idx_tasks_ready` on `tasks(user_id) WHERE blocker_count = 0 AND status = 'pending'`
- **Check constraint:** `chk_no_self_dep` on `task_dependencies`

## Counter Reconciliation

The `reconcile_counters()` function recomputes all denormalized counters from source-of-truth tables. Schedule it nightly via pg_cron:

```sql
SELECT cron.schedule('reconcile-counters', '0 3 * * *', 'SELECT reconcile_counters()');
```

## Seed Script

```bash
pnpm db:seed
```

Creates 1 user, 2 goals, 8 tasks, and 5 dependency edges. Logs trigger-maintained counter values for verification.
