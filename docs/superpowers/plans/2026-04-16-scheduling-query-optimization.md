# Scheduling Query Optimization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ORDER BY clauses to scheduling repository queries so PostgreSQL uses the composite index efficiently, preventing O(n) historical scans and guaranteeing deterministic result ordering for the frontend.

**Architecture:** The existing index `idx_scheduled_blocks_user_time(user_id, start_time, end_time)` covers all frontend scheduling queries. No new indexes are needed. The issue is that two repository methods (`getCurrentBlock`, `getBlocksForRangeWithDetails`) omit ORDER BY, causing PostgreSQL to scan in arbitrary direction instead of leveraging the index optimally.

**Tech Stack:** Drizzle ORM, PostgreSQL, NestJS, Jest

---

## Index Coverage Audit (Reference)

This audit maps every frontend endpoint to its repository query and existing index. **All queries are covered** — no new indexes required.

| Frontend Endpoint | Repository Method | WHERE Clause | Index Used | Verdict |
|---|---|---|---|---|
| `GET /v1/goals?status=active` | `GoalsRepo.findByUserId(userId, "active")` | `user_id = ? AND status = ?` | `idx_goals_user_status(user_id, status)` | Optimal |
| `GET /v1/schedule/blocks?start=&end=` | `SchedulingRepo.getBlocksForRangeWithDetails(userId, start, end)` | `user_id = ? AND start_time >= ? AND end_time <= ?` | `idx_scheduled_blocks_user_time(user_id, start_time, end_time)` | Missing ORDER BY |
| `GET /v1/schedule/now` | `SchedulingRepo.getCurrentBlock(userId)` | `user_id = ? AND start_time <= now AND end_time >= now` | `idx_scheduled_blocks_user_time(user_id, start_time, end_time)` | Missing ORDER BY DESC |
| `PATCH /v1/tasks/:id` | `TasksRepo.update(id, data)` | `id = ?` | PK | Optimal |
| `GET /api/auth/session` | Better Auth | `token = ?` | UNIQUE on `session.token` | Optimal |

### Why `getCurrentBlock` degrades without ORDER BY

The query filters `WHERE user_id = ? AND start_time <= now AND end_time >= now LIMIT 1`. Without `ORDER BY start_time DESC`, PostgreSQL scans the index **forward** from the user's oldest block. It must check every historical block's `end_time >= now` predicate (always false for old blocks) before reaching current blocks near the end. With `ORDER BY start_time DESC`, PostgreSQL scans **backward** from the most recent blocks, finding the active block immediately. This is O(1) vs O(n) where n = total historical blocks for the user.

### Why `getBlocksForRangeWithDetails` should have ORDER BY

The frontend renders blocks in time order (each row shows a time label). Without ORDER BY, PostgreSQL returns rows in undefined order. The index happens to produce roughly time-ordered results, but this is not guaranteed and can break after concurrent inserts or vacuum operations. Adding `ORDER BY start_time ASC` guarantees correct display order and matches the index scan direction.

---

### Task 1: Add ORDER BY to `getCurrentBlock`

**Files:**
- Modify: `apps/api/src/scheduling/scheduling.repository.ts:108-143`
- Test: `apps/api/src/scheduling/scheduling.repository.spec.ts`

- [ ] **Step 1: Write the failing test**

Add a test that verifies `getCurrentBlock` calls `orderBy` in the Drizzle chain. Open `apps/api/src/scheduling/scheduling.repository.spec.ts` and add this test inside a new `describe("getCurrentBlock")` block at the bottom of the file (before the closing `});`):

```typescript
describe("getCurrentBlock", () => {
  it("should query with orderBy for index-optimal scan", async () => {
    const enrichedBlock = {
      ...mockBlock,
      task: { id: 10, title: "Read", status: "pending", goalId: 1 },
      goal: { id: 1, title: "Learning", color: "#f00" },
    };
    const chain = chainMock([enrichedBlock], [
      "from",
      "innerJoin",
      "innerJoin",
      "where",
      "orderBy",
      "limit",
    ]);
    db.select.mockReturnValue(chain);

    const result = await repo.getCurrentBlock("user-1");

    expect(result).toEqual(enrichedBlock);
    expect(chain.orderBy).toHaveBeenCalled();
    expect(chain.limit).toHaveBeenCalled();
  });

  it("should return null when no current block", async () => {
    const chain = chainMock([], [
      "from",
      "innerJoin",
      "innerJoin",
      "where",
      "orderBy",
      "limit",
    ]);
    db.select.mockReturnValue(chain);

    const result = await repo.getCurrentBlock("user-1");

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/anubhav/Desktop/Projects/opensource/consistent && pnpm --filter @consistent/api test -- --testPathPattern=scheduling.repository.spec`

Expected: FAIL — `getCurrentBlock` chain doesn't include `orderBy`, so the mock chain breaks (calling `.orderBy()` on the return of `.where()` returns undefined since `.where()` returns a promise in the current mock, not a chain with `orderBy`).

- [ ] **Step 3: Add `desc` import and ORDER BY to `getCurrentBlock`**

In `apps/api/src/scheduling/scheduling.repository.ts`, change the import on line 2:

```typescript
import { eq, and, gte, lte, desc } from "drizzle-orm";
```

Then add `.orderBy(desc(scheduledBlocks.startTime))` before `.limit(1)` in `getCurrentBlock`. Replace lines 108-143 with:

```typescript
async getCurrentBlock(userId: string) {
  const now = new Date();
  const rows = await this.db
    .select({
      id: scheduledBlocks.id,
      taskId: scheduledBlocks.taskId,
      startTime: scheduledBlocks.startTime,
      endTime: scheduledBlocks.endTime,
      status: scheduledBlocks.status,
      scheduledBy: scheduledBlocks.scheduledBy,
      createdAt: scheduledBlocks.createdAt,
      task: {
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        goalId: tasks.goalId,
      },
      goal: {
        id: goals.id,
        title: goals.title,
        color: goals.color,
      },
    })
    .from(scheduledBlocks)
    .innerJoin(tasks, eq(scheduledBlocks.taskId, tasks.id))
    .innerJoin(goals, eq(tasks.goalId, goals.id))
    .where(
      and(
        eq(scheduledBlocks.userId, userId),
        lte(scheduledBlocks.startTime, now),
        gte(scheduledBlocks.endTime, now),
      ),
    )
    .orderBy(desc(scheduledBlocks.startTime))
    .limit(1);
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/anubhav/Desktop/Projects/opensource/consistent && pnpm --filter @consistent/api test -- --testPathPattern=scheduling.repository.spec`

Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git commit -m "perf(api): add ORDER BY to getCurrentBlock for index-optimal scan" -- apps/api/src/scheduling/scheduling.repository.ts apps/api/src/scheduling/scheduling.repository.spec.ts
```

---

### Task 2: Add ORDER BY to `getBlocksForRangeWithDetails`

**Files:**
- Modify: `apps/api/src/scheduling/scheduling.repository.ts:70-106`
- Test: `apps/api/src/scheduling/scheduling.repository.spec.ts`

- [ ] **Step 1: Write the failing test**

Add a test inside a new `describe("getBlocksForRangeWithDetails")` block in `scheduling.repository.spec.ts`:

```typescript
describe("getBlocksForRangeWithDetails", () => {
  it("should query with orderBy for deterministic time ordering", async () => {
    const enrichedBlock = {
      ...mockBlock,
      task: { id: 10, title: "Read", status: "pending", goalId: 1 },
      goal: { id: 1, title: "Learning", color: "#f00" },
    };
    const chain = chainMock([enrichedBlock], [
      "from",
      "innerJoin",
      "innerJoin",
      "where",
      "orderBy",
    ]);
    db.select.mockReturnValue(chain);

    const start = new Date("2026-04-16T00:00:00Z");
    const end = new Date("2026-04-16T23:59:59Z");
    const result = await repo.getBlocksForRangeWithDetails("user-1", start, end);

    expect(result).toEqual([enrichedBlock]);
    expect(chain.orderBy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/anubhav/Desktop/Projects/opensource/consistent && pnpm --filter @consistent/api test -- --testPathPattern=scheduling.repository.spec`

Expected: FAIL — `getBlocksForRangeWithDetails` chain doesn't include `orderBy`.

- [ ] **Step 3: Add `asc` import and ORDER BY to `getBlocksForRangeWithDetails`**

In `apps/api/src/scheduling/scheduling.repository.ts`, update the import on line 2 (already has `desc` from Task 1):

```typescript
import { eq, and, gte, lte, desc, asc } from "drizzle-orm";
```

Then add `.orderBy(asc(scheduledBlocks.startTime))` at the end of the query chain in `getBlocksForRangeWithDetails`. Replace lines 70-106 with:

```typescript
async getBlocksForRangeWithDetails(
  userId: string,
  start: Date,
  end: Date,
) {
  return this.db
    .select({
      id: scheduledBlocks.id,
      taskId: scheduledBlocks.taskId,
      startTime: scheduledBlocks.startTime,
      endTime: scheduledBlocks.endTime,
      status: scheduledBlocks.status,
      scheduledBy: scheduledBlocks.scheduledBy,
      createdAt: scheduledBlocks.createdAt,
      task: {
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        goalId: tasks.goalId,
      },
      goal: {
        id: goals.id,
        title: goals.title,
        color: goals.color,
      },
    })
    .from(scheduledBlocks)
    .innerJoin(tasks, eq(scheduledBlocks.taskId, tasks.id))
    .innerJoin(goals, eq(tasks.goalId, goals.id))
    .where(
      and(
        eq(scheduledBlocks.userId, userId),
        gte(scheduledBlocks.startTime, start),
        lte(scheduledBlocks.endTime, end),
      ),
    )
    .orderBy(asc(scheduledBlocks.startTime));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/anubhav/Desktop/Projects/opensource/consistent && pnpm --filter @consistent/api test -- --testPathPattern=scheduling.repository.spec`

Expected: PASS — all tests green.

- [ ] **Step 5: Run the full API test suite**

Run: `cd /Users/anubhav/Desktop/Projects/opensource/consistent && pnpm --filter @consistent/api test`

Expected: All tests pass. The service specs mock the repository, so they are unaffected.

- [ ] **Step 6: Run typecheck**

Run: `cd /Users/anubhav/Desktop/Projects/opensource/consistent && pnpm typecheck`

Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git commit -m "perf(api): add ORDER BY to getBlocksForRangeWithDetails for deterministic ordering" -- apps/api/src/scheduling/scheduling.repository.ts apps/api/src/scheduling/scheduling.repository.spec.ts
```
