# Coach Scheduling Edit Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `consistent-coach` agent single-tool-hop editing of scheduled blocks: partial update (time / status / taskId), bulk shift with two selector shapes, and soft overlap-conflict reporting on create/update/shift.

**Architecture:** Extend `SchedulingRepository` with `updateBlock`, `shiftBlocks`, and `findOverlapping`. Extend `SchedulingService` with `updateBlock(userId, id, patch)` returning `{ block, conflicts }`, plus `shiftBlocks(userId, selector)`. Widen the controller's PATCH body, add `POST /v1/schedule/blocks/shift`. Widen the `update-block` tool and add a new `shift-blocks` tool. Append a short paragraph to the coach prompt so it surfaces conflicts and uses the new shift primitive.

**Tech Stack:** NestJS 11, Drizzle 0.45 (pg driver), @mastra/core tool SDK, Zod 3, Jest 29.

**Spec:** `docs/superpowers/specs/2026-04-18-coach-scheduling-edit-tools-design.md`

---

## Notes for implementers

- Follow existing patterns strictly — repositories use `rows.at(0) ?? null`, services throw `NestJS HttpException`s, tools wrap `execute` in `safe()` returning `{ error: true, message }`.
- All services already emit realtime events after mutations. New service methods must too — `this.realtime.broadcastToUser(userId, EVENTS.SCHEDULE_UPDATED, { blockId })` (one broadcast per call; for `shiftBlocks`, send `{ blockId: null }` since it's a bulk change).
- Tests mock `../db` — keep the existing `jest.mock("../db", () => ({ DRIZZLE: require("../db/types").DRIZZLE }))` pattern.
- Services inject `RealtimeGateway` — mocks in specs must provide `{ broadcastToUser: jest.fn() }`.
- The existing `idx_scheduled_blocks_user_time` composite index on `(user_id, start_time, end_time)` already covers `findOverlapping`. No schema migration.
- The coach prompt is kept byte-stable for the prompt cache (commit abe7d63). **Append** the new paragraph — do not rewrite the existing body.
- Scope pnpm commands to workspace: `pnpm --filter @consistent/core test`.
- `pnpm typecheck` runs across the monorepo.
- **Atomic commits per layer.** List file paths explicitly in `git add` / `git commit --` — never `git add -A` or `git add .`.

---

## File Structure

### Modified

```
apps/core/src/scheduling/
  scheduling.repository.ts         # + updateBlock, shiftBlocks, findOverlapping
  scheduling.repository.spec.ts    # tests for the three new methods
  scheduling.service.ts            # + updateBlock (replaces updateBlockStatus),
                                   #   + shiftBlocks, createBlock returns conflicts
  scheduling.service.spec.ts       # updated expectations + new tests
  scheduling.controller.ts         # PATCH body widened, POST /schedule/blocks/shift added
apps/core/src/ai/tools/
  scheduling.tools.ts              # update-block widened, shift-blocks new, create-block surfaces conflicts
  scheduling.tools.spec.ts         # updated + new tests
apps/core/src/ai/prompts/
  coach.ts                         # append "Conflict handling" + "Shifting the day" paragraphs
```

### Unchanged

```
packages/contracts/src/v1/schedule.ts  # only defines GET contracts; PATCH/POST are not in ts-rest
packages/db/src/schema/scheduled-blocks.schema.ts  # no migration needed
apps/web/**                            # only reads blocks; response widening is backwards-compat
```

---

## Task 1: Repository — `updateBlock` + `findOverlapping`

**Files:**
- Modify: `apps/core/src/scheduling/scheduling.repository.ts`
- Modify: `apps/core/src/scheduling/scheduling.repository.spec.ts`

- [ ] **Step 1: Add failing tests for `updateBlock`**

Open `scheduling.repository.spec.ts`. Inside the top-level `describe("SchedulingRepository", ...)`, add this block after the existing `describe("updateBlockStatus", ...)`:

```ts
describe("updateBlock", () => {
  it("should update partial columns and return row", async () => {
    const updatedBlock = {
      ...mockBlock,
      startTime: new Date("2026-04-16T09:30:00Z"),
    };
    const chain = chainMock([updatedBlock], ["set", "where", "returning"]);
    db.update.mockReturnValue(chain);

    const result = await repo.updateBlock(1, {
      startTime: new Date("2026-04-16T09:30:00Z"),
    });

    expect(result).toEqual(updatedBlock);
    expect(chain.set).toHaveBeenCalledWith({
      startTime: new Date("2026-04-16T09:30:00Z"),
    });
  });

  it("should forward multiple fields to set()", async () => {
    const chain = chainMock([mockBlock], ["set", "where", "returning"]);
    db.update.mockReturnValue(chain);

    await repo.updateBlock(1, {
      status: "completed",
      taskId: 42,
      endTime: new Date("2026-04-16T11:00:00Z"),
    });

    expect(chain.set).toHaveBeenCalledWith({
      status: "completed",
      taskId: 42,
      endTime: new Date("2026-04-16T11:00:00Z"),
    });
  });

  it("should return null when no row updated", async () => {
    const chain = chainMock([], ["set", "where", "returning"]);
    db.update.mockReturnValue(chain);

    const result = await repo.updateBlock(999, { status: "completed" });

    expect(result).toBeNull();
  });
});

describe("findOverlapping", () => {
  it("should run a select filtered by userId and time range", async () => {
    const blocks = [mockBlock];
    const chain = chainMock(blocks, ["from", "where"]);
    db.select.mockReturnValue(chain);

    const result = await repo.findOverlapping(
      "user-1",
      new Date("2026-04-16T09:00:00Z"),
      new Date("2026-04-16T10:00:00Z"),
    );

    expect(result).toEqual(blocks);
    expect(db.select).toHaveBeenCalled();
    expect(chain.where).toHaveBeenCalled();
  });

  it("should accept excludeIds and still return rows", async () => {
    const chain = chainMock([], ["from", "where"]);
    db.select.mockReturnValue(chain);

    const result = await repo.findOverlapping(
      "user-1",
      new Date("2026-04-16T09:00:00Z"),
      new Date("2026-04-16T10:00:00Z"),
      [1, 2],
    );

    expect(result).toEqual([]);
    expect(chain.where).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `pnpm --filter @consistent/core test -- --testPathPattern=scheduling.repository`
Expected: FAIL — `repo.updateBlock is not a function`, `repo.findOverlapping is not a function`.

- [ ] **Step 3: Implement the two methods**

Open `scheduling.repository.ts`. Add imports if needed (`lt`, `gt`, `notInArray`, `or`):

```ts
import { eq, and, gte, lte, lt, gt, desc, asc, or, notInArray } from "drizzle-orm";
```

Insert both methods after the existing `updateBlockStatus` method:

```ts
  async updateBlock(
    id: number,
    patch: Partial<
      Pick<
        typeof scheduledBlocks.$inferInsert,
        "status" | "startTime" | "endTime" | "taskId"
      >
    >,
  ) {
    const rows = await this.db
      .update(scheduledBlocks)
      .set(patch)
      .where(eq(scheduledBlocks.id, id))
      .returning();
    return rows.at(0) ?? null;
  }

  async findOverlapping(
    userId: string,
    start: Date,
    end: Date,
    excludeIds: number[] = [],
  ) {
    const conditions = [
      eq(scheduledBlocks.userId, userId),
      lt(scheduledBlocks.startTime, end),
      gt(scheduledBlocks.endTime, start),
    ];
    if (excludeIds.length > 0) {
      conditions.push(notInArray(scheduledBlocks.id, excludeIds));
    }
    return this.db
      .select()
      .from(scheduledBlocks)
      .where(and(...conditions));
  }
```

- [ ] **Step 4: Run tests — should pass**

Run: `pnpm --filter @consistent/core test -- --testPathPattern=scheduling.repository`
Expected: PASS for the new describe blocks. Existing tests still green.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(scheduling): add updateBlock and findOverlapping repo methods" -- \
  apps/core/src/scheduling/scheduling.repository.ts \
  apps/core/src/scheduling/scheduling.repository.spec.ts
```

---

## Task 2: Repository — `shiftBlocks`

**Files:**
- Modify: `apps/core/src/scheduling/scheduling.repository.ts`
- Modify: `apps/core/src/scheduling/scheduling.repository.spec.ts`

- [ ] **Step 1: Add failing test**

Append to `scheduling.repository.spec.ts` after the `findOverlapping` describe:

```ts
describe("shiftBlocks", () => {
  it("should update each block atomically and return the rows", async () => {
    const tx = {
      update: jest.fn(),
    };
    const chain = chainMock([mockBlock], ["set", "where", "returning"]);
    tx.update.mockReturnValue(chain);
    db.transaction = jest.fn(async (cb: any) => cb(tx));

    const result = await repo.shiftBlocks([1, 2], 30);

    expect(db.transaction).toHaveBeenCalled();
    expect(tx.update).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
  });

  it("should return empty array when given no ids", async () => {
    db.transaction = jest.fn(async (cb: any) => cb({ update: jest.fn() }));
    const result = await repo.shiftBlocks([], 30);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm --filter @consistent/core test -- --testPathPattern=scheduling.repository`
Expected: FAIL — `repo.shiftBlocks is not a function`.

- [ ] **Step 3: Implement `shiftBlocks`**

Add this import line to `scheduling.repository.ts` (at top with the drizzle imports):

```ts
import { sql } from "drizzle-orm";
```

Append to `scheduling.repository.ts` after `updateBlock`:

```ts
  async shiftBlocks(ids: number[], deltaMinutes: number) {
    if (ids.length === 0) return [];
    return this.db.transaction(async (tx) => {
      const rows: Array<typeof scheduledBlocks.$inferSelect> = [];
      for (const id of ids) {
        const updated = await tx
          .update(scheduledBlocks)
          .set({
            startTime: sql`${scheduledBlocks.startTime} + make_interval(mins => ${deltaMinutes})`,
            endTime: sql`${scheduledBlocks.endTime} + make_interval(mins => ${deltaMinutes})`,
          })
          .where(eq(scheduledBlocks.id, id))
          .returning();
        if (updated.at(0)) rows.push(updated[0]!);
      }
      return rows;
    });
  }
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter @consistent/core test -- --testPathPattern=scheduling.repository`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(scheduling): add shiftBlocks repo method" -- \
  apps/core/src/scheduling/scheduling.repository.ts \
  apps/core/src/scheduling/scheduling.repository.spec.ts
```

---

## Task 3: Service — `updateBlock` returns `{ block, conflicts }`

Keep `updateBlockStatus` as a thin wrapper for now so the controller/tool keep compiling; we'll remove it in Task 11 after controllers and tools migrate.

**Files:**
- Modify: `apps/core/src/scheduling/scheduling.service.ts`
- Modify: `apps/core/src/scheduling/scheduling.service.spec.ts`

- [ ] **Step 1: Add mocks and failing tests for `updateBlock`**

In `scheduling.service.spec.ts`, extend the `useValue` of `SchedulingRepository` in the `beforeEach` to include:

```ts
useValue: {
  findBlockById: jest.fn(),
  createBlock: jest.fn(),
  getBlocksForRange: jest.fn(),
  getBlocksForRangeWithDetails: jest.fn(),
  getCurrentBlock: jest.fn(),
  updateBlockStatus: jest.fn(),
  updateBlock: jest.fn(),
  findOverlapping: jest.fn(),
  shiftBlocks: jest.fn(),
  deleteBlock: jest.fn(),
},
```

Add this describe block after `describe("updateBlockStatus", ...)`:

```ts
describe("updateBlock", () => {
  const updated = { ...mockBlock, endTime: new Date("2026-04-16T11:00:00Z") };

  it("should patch times and return { block, conflicts }", async () => {
    schedulingRepo.findBlockById.mockResolvedValue(mockBlock as any);
    schedulingRepo.updateBlock.mockResolvedValue(updated as any);
    schedulingRepo.findOverlapping.mockResolvedValue([]);

    const result = await service.updateBlock(userId, 1, {
      endTime: new Date("2026-04-16T11:00:00Z"),
    });

    expect(result).toEqual({ block: updated, conflicts: [] });
    expect(schedulingRepo.updateBlock).toHaveBeenCalledWith(1, {
      endTime: new Date("2026-04-16T11:00:00Z"),
    });
  });

  it("should verify new task ownership when taskId changes", async () => {
    schedulingRepo.findBlockById.mockResolvedValue(mockBlock as any);
    tasksRepo.findById.mockResolvedValue({ ...mockTask, id: 99 } as any);
    schedulingRepo.updateBlock.mockResolvedValue({ ...updated, taskId: 99 } as any);
    schedulingRepo.findOverlapping.mockResolvedValue([]);

    await service.updateBlock(userId, 1, { taskId: 99 });

    expect(tasksRepo.findById).toHaveBeenCalledWith(99);
  });

  it("should throw NotFoundException when new task not owned", async () => {
    schedulingRepo.findBlockById.mockResolvedValue(mockBlock as any);
    tasksRepo.findById.mockResolvedValue({ ...mockTask, userId: otherUserId } as any);

    await expect(
      service.updateBlock(userId, 1, { taskId: 99 }),
    ).rejects.toThrow(NotFoundException);
  });

  it("should throw BadRequestException when effective start >= end", async () => {
    schedulingRepo.findBlockById.mockResolvedValue(mockBlock as any);

    await expect(
      service.updateBlock(userId, 1, {
        endTime: new Date("2026-04-16T08:00:00Z"),
      }),
    ).rejects.toThrow("Start time must be before end time");
  });

  it("should throw NotFoundException when block not owned", async () => {
    schedulingRepo.findBlockById.mockResolvedValue(mockBlock as any);

    await expect(
      service.updateBlock(otherUserId, 1, { status: "completed" }),
    ).rejects.toThrow(NotFoundException);
  });

  it("should exclude the block itself from overlap check", async () => {
    schedulingRepo.findBlockById.mockResolvedValue(mockBlock as any);
    schedulingRepo.updateBlock.mockResolvedValue(updated as any);
    schedulingRepo.findOverlapping.mockResolvedValue([]);

    await service.updateBlock(userId, 1, {
      endTime: new Date("2026-04-16T11:00:00Z"),
    });

    expect(schedulingRepo.findOverlapping).toHaveBeenCalledWith(
      userId,
      mockBlock.startTime,
      new Date("2026-04-16T11:00:00Z"),
      [1],
    );
  });

  it("should return conflict summaries when overlap found", async () => {
    const conflicting = {
      id: 7,
      taskId: 11,
      startTime: new Date("2026-04-16T10:30:00Z"),
      endTime: new Date("2026-04-16T11:30:00Z"),
    };
    schedulingRepo.findBlockById.mockResolvedValue(mockBlock as any);
    schedulingRepo.updateBlock.mockResolvedValue(updated as any);
    schedulingRepo.findOverlapping.mockResolvedValue([conflicting] as any);
    tasksRepo.findById.mockResolvedValue({ ...mockTask, id: 11, title: "Run" } as any);

    const result = await service.updateBlock(userId, 1, {
      endTime: new Date("2026-04-16T11:00:00Z"),
    });

    expect(result.conflicts).toEqual([
      {
        blockId: 7,
        taskId: 11,
        taskTitle: "Run",
        startTime: conflicting.startTime.toISOString(),
        endTime: conflicting.endTime.toISOString(),
      },
    ]);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm --filter @consistent/core test -- --testPathPattern=scheduling.service`
Expected: FAIL — `service.updateBlock is not a function`.

- [ ] **Step 3: Implement `updateBlock`**

In `scheduling.service.ts`, add two imports nothing new is required (we already have `BadRequestException`, `NotFoundException`).

Add the interface next to `CreateBlockInput`:

```ts
export interface UpdateBlockPatch {
  status?: "planned" | "confirmed" | "completed" | "missed" | "moved";
  startTime?: Date;
  endTime?: Date;
  taskId?: number;
}

export interface ConflictSummary {
  blockId: number;
  taskId: number;
  taskTitle: string;
  startTime: string;
  endTime: string;
}
```

Add a private helper for conflict summaries:

```ts
  private async summarizeConflicts(
    rawConflicts: Array<{
      id: number;
      taskId: number;
      startTime: Date;
      endTime: Date;
    }>,
  ): Promise<ConflictSummary[]> {
    const summaries: ConflictSummary[] = [];
    for (const c of rawConflicts) {
      const task = await this.tasksRepo.findById(c.taskId);
      summaries.push({
        blockId: c.id,
        taskId: c.taskId,
        taskTitle: task?.title ?? "(unknown task)",
        startTime: c.startTime.toISOString(),
        endTime: c.endTime.toISOString(),
      });
    }
    return summaries;
  }
```

Add the main method (place after `updateBlockStatus`):

```ts
  async updateBlock(
    userId: string,
    blockId: number,
    patch: UpdateBlockPatch,
  ): Promise<{ block: typeof import("@consistent/db/schema").scheduledBlocks.$inferSelect; conflicts: ConflictSummary[] }> {
    const existing = await this.verifyBlockOwnership(userId, blockId);

    if (patch.taskId !== undefined && patch.taskId !== existing.taskId) {
      const task = await this.tasksRepo.findById(patch.taskId);
      if (!task || task.userId !== userId) {
        throw new NotFoundException("Task not found");
      }
    }

    const effectiveStart = patch.startTime ?? existing.startTime;
    const effectiveEnd = patch.endTime ?? existing.endTime;
    if (effectiveStart >= effectiveEnd) {
      throw new BadRequestException("Start time must be before end time");
    }

    const updated = await this.schedulingRepo.updateBlock(blockId, patch);
    if (!updated) throw new NotFoundException("Scheduled block not found");

    const rawConflicts = await this.schedulingRepo.findOverlapping(
      userId,
      effectiveStart,
      effectiveEnd,
      [blockId],
    );
    const conflicts = await this.summarizeConflicts(rawConflicts);

    this.realtime.broadcastToUser(userId, EVENTS.SCHEDULE_UPDATED, { blockId });
    return { block: updated, conflicts };
  }
```

Keep the existing `updateBlockStatus` untouched — it still delegates to `schedulingRepo.updateBlockStatus`. We'll remove both later.

If the `scheduledBlocks` import in the return type gets ugly, extract a type alias at the top of the file:

```ts
import { scheduledBlocks } from "@consistent/db/schema";
type ScheduledBlock = typeof scheduledBlocks.$inferSelect;
```

and replace the return type with `Promise<{ block: ScheduledBlock; conflicts: ConflictSummary[] }>`.

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter @consistent/core test -- --testPathPattern=scheduling.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(scheduling): service.updateBlock with partial patch and conflicts" -- \
  apps/core/src/scheduling/scheduling.service.ts \
  apps/core/src/scheduling/scheduling.service.spec.ts
```

---

## Task 4: Service — `shiftBlocks`

**Files:**
- Modify: `apps/core/src/scheduling/scheduling.service.ts`
- Modify: `apps/core/src/scheduling/scheduling.service.spec.ts`

- [ ] **Step 1: Add failing tests**

Append to `scheduling.service.spec.ts`:

```ts
describe("shiftBlocks", () => {
  const block1 = { ...mockBlock, id: 1 };
  const block2 = {
    ...mockBlock,
    id: 2,
    startTime: new Date("2026-04-16T11:00:00Z"),
    endTime: new Date("2026-04-16T12:00:00Z"),
  };

  it("should shift explicit blockIds after ownership check", async () => {
    schedulingRepo.findBlockById.mockImplementation(async (id: number) =>
      id === 1 ? (block1 as any) : (block2 as any),
    );
    const shifted = [
      { ...block1, startTime: new Date("2026-04-16T09:30:00Z"), endTime: new Date("2026-04-16T10:30:00Z") },
      { ...block2, startTime: new Date("2026-04-16T11:30:00Z"), endTime: new Date("2026-04-16T12:30:00Z") },
    ];
    schedulingRepo.shiftBlocks.mockResolvedValue(shifted as any);
    schedulingRepo.findOverlapping.mockResolvedValue([]);

    const result = await service.shiftBlocks(userId, {
      blockIds: [1, 2],
      deltaMinutes: 30,
    });

    expect(schedulingRepo.shiftBlocks).toHaveBeenCalledWith([1, 2], 30);
    expect(result.blocks).toEqual(shifted);
    expect(result.conflicts).toEqual([]);
  });

  it("should resolve afterTime selector by querying blocks >= afterTime", async () => {
    schedulingRepo.getBlocksForRange.mockResolvedValue([block1, block2] as any);
    schedulingRepo.shiftBlocks.mockResolvedValue([block1, block2] as any);
    schedulingRepo.findOverlapping.mockResolvedValue([]);

    await service.shiftBlocks(userId, {
      afterTime: new Date("2026-04-16T08:00:00Z"),
      deltaMinutes: 15,
    });

    expect(schedulingRepo.shiftBlocks).toHaveBeenCalledWith([1, 2], 15);
  });

  it("should reject when both selectors provided", async () => {
    await expect(
      service.shiftBlocks(userId, {
        blockIds: [1],
        afterTime: new Date(),
        deltaMinutes: 10,
      } as any),
    ).rejects.toThrow("Provide exactly one of blockIds or afterTime");
  });

  it("should reject when neither selector provided", async () => {
    await expect(
      service.shiftBlocks(userId, { deltaMinutes: 10 } as any),
    ).rejects.toThrow("Provide exactly one of blockIds or afterTime");
  });

  it("should reject deltaMinutes of 0", async () => {
    await expect(
      service.shiftBlocks(userId, { blockIds: [1], deltaMinutes: 0 }),
    ).rejects.toThrow("deltaMinutes must be non-zero");
  });

  it("should throw when a blockId is not owned", async () => {
    schedulingRepo.findBlockById.mockImplementation(async (id: number) =>
      id === 1 ? (block1 as any) : null,
    );

    await expect(
      service.shiftBlocks(userId, { blockIds: [1, 999], deltaMinutes: 30 }),
    ).rejects.toThrow(NotFoundException);
  });

  it("should exclude the shifted cohort from conflict detection", async () => {
    schedulingRepo.findBlockById.mockImplementation(async (id: number) =>
      id === 1 ? (block1 as any) : (block2 as any),
    );
    schedulingRepo.shiftBlocks.mockResolvedValue([block1, block2] as any);
    schedulingRepo.findOverlapping.mockResolvedValue([]);

    await service.shiftBlocks(userId, { blockIds: [1, 2], deltaMinutes: 30 });

    expect(schedulingRepo.findOverlapping).toHaveBeenCalledWith(
      userId,
      expect.any(Date),
      expect.any(Date),
      [1, 2],
    );
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm --filter @consistent/core test -- --testPathPattern=scheduling.service`
Expected: FAIL.

- [ ] **Step 3: Implement `shiftBlocks`**

Add interface near `UpdateBlockPatch`:

```ts
export type ShiftBlocksInput =
  | { blockIds: number[]; deltaMinutes: number; afterTime?: undefined }
  | { afterTime: Date; deltaMinutes: number; blockIds?: undefined };
```

Add method after `updateBlock` in the service:

```ts
  async shiftBlocks(userId: string, input: ShiftBlocksInput) {
    const hasIds = Array.isArray(input.blockIds) && input.blockIds.length > 0;
    const hasAfter = input.afterTime instanceof Date;
    if (hasIds === hasAfter) {
      throw new BadRequestException(
        "Provide exactly one of blockIds or afterTime",
      );
    }
    if (!input.deltaMinutes) {
      throw new BadRequestException("deltaMinutes must be non-zero");
    }

    let ids: number[];
    if (hasIds) {
      ids = input.blockIds!;
      for (const id of ids) {
        await this.verifyBlockOwnership(userId, id);
      }
    } else {
      const far = new Date("9999-12-31T00:00:00Z");
      const blocks = await this.schedulingRepo.getBlocksForRange(
        userId,
        input.afterTime!,
        far,
      );
      ids = blocks.map((b) => b.id);
    }

    if (ids.length === 0) {
      return { blocks: [], conflicts: [] };
    }

    const shifted = await this.schedulingRepo.shiftBlocks(
      ids,
      input.deltaMinutes,
    );
    shifted.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    let rawConflicts: Array<{
      id: number;
      taskId: number;
      startTime: Date;
      endTime: Date;
    }> = [];
    if (shifted.length > 0) {
      const minStart = shifted[0]!.startTime;
      const maxEnd = shifted.reduce(
        (acc, b) => (b.endTime > acc ? b.endTime : acc),
        shifted[0]!.endTime,
      );
      rawConflicts = await this.schedulingRepo.findOverlapping(
        userId,
        minStart,
        maxEnd,
        ids,
      );
    }
    const conflicts = await this.summarizeConflicts(rawConflicts);

    this.realtime.broadcastToUser(userId, EVENTS.SCHEDULE_UPDATED, {});

    return { blocks: shifted, conflicts };
  }
```

Note: `schedule:updated` payload schema (see `packages/realtime/src/events.ts`) is `{ blockId?: number }` — for a bulk shift, omit `blockId` entirely as shown. The frontend invalidates the whole `["schedule"]` query on this event regardless of payload.

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter @consistent/core test -- --testPathPattern=scheduling.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(scheduling): service.shiftBlocks with dual selector" -- \
  apps/core/src/scheduling/scheduling.service.ts \
  apps/core/src/scheduling/scheduling.service.spec.ts
```

---

## Task 5: Service — `createBlock` returns `{ block, conflicts }`

**Files:**
- Modify: `apps/core/src/scheduling/scheduling.service.ts`
- Modify: `apps/core/src/scheduling/scheduling.service.spec.ts`

- [ ] **Step 1: Update existing `createBlock` tests to expect new shape**

Find these assertions in the `describe("createBlock", ...)` block:

```ts
expect(result).toEqual(mockBlock);
```

Replace with:

```ts
expect(result).toEqual({ block: mockBlock, conflicts: [] });
```

Add a new test to the same describe:

```ts
it("should include overlap conflicts in the response", async () => {
  const conflicting = {
    id: 7,
    taskId: 11,
    startTime: new Date("2026-04-16T09:30:00Z"),
    endTime: new Date("2026-04-16T10:30:00Z"),
  };
  tasksRepo.findById.mockImplementation(async (id: number) =>
    id === 11
      ? ({ ...mockTask, id: 11, title: "Run" } as any)
      : (mockTask as any),
  );
  schedulingRepo.createBlock.mockResolvedValue(mockBlock as any);
  schedulingRepo.findOverlapping.mockResolvedValue([conflicting] as any);

  const result = await service.createBlock(userId, {
    taskId: 10,
    startTime: new Date("2026-04-16T09:00:00Z"),
    endTime: new Date("2026-04-16T10:00:00Z"),
  });

  expect(result.conflicts).toHaveLength(1);
  expect(result.conflicts[0].blockId).toBe(7);
});
```

Make sure `findOverlapping` is stubbed to `[]` in the earlier successful-create tests; add `schedulingRepo.findOverlapping.mockResolvedValue([]);` to each of them.

- [ ] **Step 2: Run — expect failure**

Run: `pnpm --filter @consistent/core test -- --testPathPattern=scheduling.service`
Expected: FAIL — old shape returned.

- [ ] **Step 3: Update `createBlock` to compute conflicts**

Replace the tail of `createBlock` after `const block = await this.schedulingRepo.createBlock(...)`:

```ts
    const rawConflicts = await this.schedulingRepo.findOverlapping(
      userId,
      startTime,
      endTime,
      [block.id],
    );
    const conflicts = await this.summarizeConflicts(rawConflicts);

    this.realtime.broadcastToUser(userId, EVENTS.SCHEDULE_UPDATED, {
      blockId: block.id,
    });
    return { block, conflicts };
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter @consistent/core test -- --testPathPattern=scheduling.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(scheduling): createBlock returns overlap conflicts" -- \
  apps/core/src/scheduling/scheduling.service.ts \
  apps/core/src/scheduling/scheduling.service.spec.ts
```

---

## Task 6: Controller — expand PATCH, add POST /shift

**Files:**
- Modify: `apps/core/src/scheduling/scheduling.controller.ts`

- [ ] **Step 1: Widen PATCH body and migrate to `updateBlock`**

Replace the existing `@Patch("schedule/blocks/:id")` handler in `scheduling.controller.ts`:

```ts
  @Patch("schedule/blocks/:id")
  updateBlock(
    @CurrentUser() user: any,
    @Param("id", ParseIntPipe) id: number,
    @Body()
    body: {
      status?: "planned" | "confirmed" | "completed" | "missed" | "moved";
      startTime?: string;
      endTime?: string;
      taskId?: number;
    },
  ) {
    const patch: Parameters<SchedulingService["updateBlock"]>[2] = {};
    if (body.status !== undefined) patch.status = body.status;
    if (body.taskId !== undefined) patch.taskId = body.taskId;
    if (body.startTime !== undefined) {
      const d = new Date(body.startTime);
      if (isNaN(d.getTime())) {
        throw new BadRequestException("Invalid startTime format");
      }
      patch.startTime = d;
    }
    if (body.endTime !== undefined) {
      const d = new Date(body.endTime);
      if (isNaN(d.getTime())) {
        throw new BadRequestException("Invalid endTime format");
      }
      patch.endTime = d;
    }
    return this.schedulingService.updateBlock(user.id, id, patch);
  }
```

- [ ] **Step 2: Add `POST /schedule/blocks/shift`**

Append to the controller class:

```ts
  @Post("schedule/blocks/shift")
  shift(
    @CurrentUser() user: any,
    @Body()
    body: {
      deltaMinutes: number;
      blockIds?: number[];
      afterTime?: string;
    },
  ) {
    if (typeof body.deltaMinutes !== "number") {
      throw new BadRequestException("deltaMinutes is required");
    }
    if ((body.blockIds && body.afterTime) || (!body.blockIds && !body.afterTime)) {
      throw new BadRequestException(
        "Provide exactly one of blockIds or afterTime",
      );
    }
    if (body.blockIds) {
      return this.schedulingService.shiftBlocks(user.id, {
        blockIds: body.blockIds,
        deltaMinutes: body.deltaMinutes,
      });
    }
    const d = new Date(body.afterTime!);
    if (isNaN(d.getTime())) {
      throw new BadRequestException("Invalid afterTime format");
    }
    return this.schedulingService.shiftBlocks(user.id, {
      afterTime: d,
      deltaMinutes: body.deltaMinutes,
    });
  }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @consistent/core typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(scheduling): widen PATCH body and add POST /schedule/blocks/shift" -- \
  apps/core/src/scheduling/scheduling.controller.ts
```

---

## Task 7: Tool — `update-block` widened + surfaces conflicts

**Files:**
- Modify: `apps/core/src/ai/tools/scheduling.tools.ts`
- Modify: `apps/core/src/ai/tools/scheduling.tools.spec.ts`

- [ ] **Step 1: Update existing `update-block` test expectations**

In `scheduling.tools.spec.ts`, replace the existing `it("update-block calls updateBlockStatus", ...)` test with:

```ts
it("update-block forwards status-only patch to service.updateBlock", async () => {
  (svc.updateBlock as jest.Mock) = jest.fn().mockResolvedValue({
    block: { id: 1 },
    conflicts: [],
  });
  await tools["update-block"].execute!(
    { blockId: 1, status: "completed" },
    mockContext,
  );
  expect(svc.updateBlock).toHaveBeenCalledWith("user-123", 1, {
    status: "completed",
  });
});

it("update-block converts ISO times to Date and passes taskId", async () => {
  (svc.updateBlock as jest.Mock) = jest.fn().mockResolvedValue({
    block: { id: 1 },
    conflicts: [],
  });
  await tools["update-block"].execute!(
    {
      blockId: 1,
      startTime: "2026-04-17T09:00:00Z",
      endTime: "2026-04-17T10:30:00Z",
      taskId: 42,
    },
    mockContext,
  );
  expect(svc.updateBlock).toHaveBeenCalledWith("user-123", 1, {
    startTime: new Date("2026-04-17T09:00:00Z"),
    endTime: new Date("2026-04-17T10:30:00Z"),
    taskId: 42,
  });
});
```

Also add `updateBlock: jest.fn()` to the `svc` mock object definition at the top.

- [ ] **Step 2: Run — expect failure**

Run: `pnpm --filter @consistent/core test -- --testPathPattern=scheduling.tools`
Expected: FAIL.

- [ ] **Step 3: Replace `update-block` tool**

In `scheduling.tools.ts`, replace the existing `updateBlock` tool constant with:

```ts
  const updateBlock = createTool({
    id: "update-block",
    description:
      "Partial update on a scheduled block. Any subset of { status, startTime, endTime, taskId } is valid — e.g. send only endTime to extend the block. Returns { block, conflicts }; surface any conflicts to the user rather than silently overwriting.",
    inputSchema: z.object({
      blockId: z.number(),
      status: z
        .enum(["planned", "confirmed", "completed", "missed", "moved"])
        .optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
      taskId: z.number().optional(),
    }),
    outputSchema: z.any(),
    execute: async (input, context) =>
      safe(async () => {
        const patch: Parameters<SchedulingService["updateBlock"]>[2] = {};
        if (input.status !== undefined) patch.status = input.status;
        if (input.taskId !== undefined) patch.taskId = input.taskId;
        if (input.startTime !== undefined)
          patch.startTime = new Date(input.startTime);
        if (input.endTime !== undefined)
          patch.endTime = new Date(input.endTime);
        return schedulingService.updateBlock(
          getUserId(context),
          input.blockId,
          patch,
        );
      }),
  });
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter @consistent/core test -- --testPathPattern=scheduling.tools`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ai): update-block tool accepts partial patch and returns conflicts" -- \
  apps/core/src/ai/tools/scheduling.tools.ts \
  apps/core/src/ai/tools/scheduling.tools.spec.ts
```

---

## Task 8: Tool — `shift-blocks`

**Files:**
- Modify: `apps/core/src/ai/tools/scheduling.tools.ts`
- Modify: `apps/core/src/ai/tools/scheduling.tools.spec.ts`

- [ ] **Step 1: Add failing test**

Add `shiftBlocks: jest.fn()` to the `svc` mock definition. Append to `scheduling.tools.spec.ts`:

```ts
describe("shift-blocks", () => {
  it("forwards explicit blockIds selector", async () => {
    (svc.shiftBlocks as jest.Mock) = jest.fn().mockResolvedValue({
      blocks: [],
      conflicts: [],
    });
    await tools["shift-blocks"].execute!(
      { blockIds: [1, 2], deltaMinutes: 30 },
      mockContext,
    );
    expect(svc.shiftBlocks).toHaveBeenCalledWith("user-123", {
      blockIds: [1, 2],
      deltaMinutes: 30,
    });
  });

  it("converts afterTime ISO to Date", async () => {
    (svc.shiftBlocks as jest.Mock) = jest.fn().mockResolvedValue({
      blocks: [],
      conflicts: [],
    });
    await tools["shift-blocks"].execute!(
      { afterTime: "2026-04-17T13:00:00Z", deltaMinutes: -15 },
      mockContext,
    );
    expect(svc.shiftBlocks).toHaveBeenCalledWith("user-123", {
      afterTime: new Date("2026-04-17T13:00:00Z"),
      deltaMinutes: -15,
    });
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm --filter @consistent/core test -- --testPathPattern=scheduling.tools`
Expected: FAIL.

- [ ] **Step 3: Implement the `shift-blocks` tool**

In `scheduling.tools.ts`, add before the `return { ... }` block:

```ts
  const shiftBlocks = createTool({
    id: "shift-blocks",
    description:
      "Shift one or more blocks forward or backward in time by deltaMinutes (may be negative). Use blockIds when you already know which blocks to move (e.g. the ones you just listed to the user). Use afterTime when the user's day was disrupted and everything from a point onward should slide — this saves a get-schedule call. Exactly one selector must be provided. Runs in one transaction; ownership is enforced server-side. Returns { blocks, conflicts } — surface conflicts to the user before assuming the shift is final.",
    inputSchema: z
      .object({
        deltaMinutes: z.number().int().describe("Positive shifts later, negative shifts earlier. Must be non-zero."),
        blockIds: z.array(z.number()).optional(),
        afterTime: z
          .string()
          .optional()
          .describe("ISO 8601. Shifts every block whose startTime >= this instant."),
      })
      .refine(
        (v) => (v.blockIds ? !v.afterTime : !!v.afterTime),
        { message: "Provide exactly one of blockIds or afterTime" },
      ),
    outputSchema: z.any(),
    execute: async (input, context) =>
      safe(async () => {
        if (input.blockIds) {
          return schedulingService.shiftBlocks(getUserId(context), {
            blockIds: input.blockIds,
            deltaMinutes: input.deltaMinutes,
          });
        }
        return schedulingService.shiftBlocks(getUserId(context), {
          afterTime: new Date(input.afterTime!),
          deltaMinutes: input.deltaMinutes,
        });
      }),
  });
```

Update the return object at the bottom of `createSchedulingTools`:

```ts
  return {
    "get-schedule": getSchedule,
    "get-current-block": getCurrentBlock,
    "create-block": createBlock,
    "update-block": updateBlock,
    "shift-blocks": shiftBlocks,
    "delete-block": deleteBlock,
  };
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter @consistent/core test -- --testPathPattern=scheduling.tools`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ai): add shift-blocks tool with dual selector" -- \
  apps/core/src/ai/tools/scheduling.tools.ts \
  apps/core/src/ai/tools/scheduling.tools.spec.ts
```

---

## Task 9: Tool — `create-block` surfaces conflicts

**Files:**
- Modify: `apps/core/src/ai/tools/scheduling.tools.ts`
- Modify: `apps/core/src/ai/tools/scheduling.tools.spec.ts`

- [ ] **Step 1: Update test expectation**

In `scheduling.tools.spec.ts`, update the `create-block` test:

```ts
it("create-block normalizes Dates, passes scheduledBy=llm, returns conflicts", async () => {
  (svc.createBlock as jest.Mock).mockResolvedValue({
    block: { id: 1 },
    conflicts: [],
  });
  const input = {
    taskId: 42,
    startTime: "2026-04-17T09:00:00Z",
    endTime: "2026-04-17T10:00:00Z",
  };
  const result = await tools["create-block"].execute!(input, mockContext);
  expect(svc.createBlock).toHaveBeenCalledWith("user-123", {
    taskId: 42,
    startTime: new Date(input.startTime),
    endTime: new Date(input.endTime),
    scheduledBy: "llm",
  });
  expect(result).toEqual({ block: { id: 1 }, conflicts: [] });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm --filter @consistent/core test -- --testPathPattern=scheduling.tools`
Expected: FAIL — current tool wraps return in `{ block: ... }`, losing conflicts.

- [ ] **Step 3: Update `create-block` tool to pass-through service response**

In `scheduling.tools.ts`, replace the `createBlock` tool's `execute`:

```ts
    execute: async (input, context) =>
      safe(async () =>
        schedulingService.createBlock(getUserId(context), {
          taskId: input.taskId,
          startTime: new Date(input.startTime),
          endTime: new Date(input.endTime),
          scheduledBy: "llm",
        }),
      ),
```

And update the description to mention conflicts:

```ts
    description:
      "Schedule a time block for a task. Returns { block, conflicts }; if conflicts is non-empty, surface them before moving on.",
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter @consistent/core test -- --testPathPattern=scheduling.tools`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ai): create-block tool passes through block and conflicts" -- \
  apps/core/src/ai/tools/scheduling.tools.ts \
  apps/core/src/ai/tools/scheduling.tools.spec.ts
```

---

## Task 10: Coach prompt — append conflict + shift paragraphs

**Files:**
- Modify: `apps/core/src/ai/prompts/coach.ts`

- [ ] **Step 1: Append two paragraphs at the end of the prompt**

Open `apps/core/src/ai/prompts/coach.ts`. The last backtick in the template literal is preceded by `- Short sentences. Use their language, not yours.`. **Append** (do not rewrite) the following paragraphs *before* the closing backtick so earlier bytes remain cache-stable:

```

# Editing scheduled blocks

update-block is a partial update — send only the fields you want to change (e.g. just endTime to extend a block). Never delete-and-recreate to change a block's time or task; use update-block in a single hop.

When an update or create response includes non-empty conflicts, stop and tell the user which existing block(s) overlap before moving on. Ask how to resolve — don't silently overwrite.

# Shifting the day

When the user's day runs long or plans slip, use shift-blocks instead of updating blocks one by one. If you already have the affected block ids (e.g. from the last get-schedule call), pass blockIds. If the user says "push everything after X," pass afterTime — the server will find and shift every block whose startTime is at or after that instant, in one transaction.
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @consistent/core typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(ai): teach coach about partial block updates, conflicts, and shift-blocks" -- \
  apps/core/src/ai/prompts/coach.ts
```

---

## Task 11: Remove legacy `updateBlockStatus`

Now that controller and tool use `updateBlock`, the old wrapper is dead code.

**Files:**
- Modify: `apps/core/src/scheduling/scheduling.service.ts`
- Modify: `apps/core/src/scheduling/scheduling.service.spec.ts`
- Modify: `apps/core/src/scheduling/scheduling.repository.ts`
- Modify: `apps/core/src/scheduling/scheduling.repository.spec.ts`

- [ ] **Step 1: Delete the `updateBlockStatus` describe block from both specs**

In `scheduling.service.spec.ts`, remove the entire `describe("updateBlockStatus", ...)` block.

In `scheduling.repository.spec.ts`, remove the entire `describe("updateBlockStatus", ...)` block.

- [ ] **Step 2: Delete the `updateBlockStatus` methods**

In `scheduling.service.ts`, delete the `updateBlockStatus` method.

In `scheduling.repository.ts`, delete the `updateBlockStatus` method.

Also remove `updateBlockStatus: jest.fn()` from the repo mock in `scheduling.service.spec.ts` `beforeEach`.

- [ ] **Step 3: Run the full workspace test + typecheck**

Run: `pnpm --filter @consistent/core test`
Expected: PASS.

Run: `pnpm --filter @consistent/core typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(scheduling): remove updateBlockStatus in favor of updateBlock" -- \
  apps/core/src/scheduling/scheduling.service.ts \
  apps/core/src/scheduling/scheduling.service.spec.ts \
  apps/core/src/scheduling/scheduling.repository.ts \
  apps/core/src/scheduling/scheduling.repository.spec.ts
```

---

## Task 12: Full verification

**Files:** none

- [ ] **Step 1: Run workspace tests**

Run: `pnpm --filter @consistent/core test`
Expected: all scheduling specs PASS; everything else green.

- [ ] **Step 2: Run monorepo typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Format check**

Run: `pnpm format:check`
Expected: no diff. If diff, run `pnpm format` and commit the formatting fix separately.

- [ ] **Step 4: Manual smoke (optional but recommended)**

Start API + web: `pnpm dev`. In the coach, try:
1. "Extend my current block by an hour" — expect one tool hop, no delete-confirm turn.
2. "Push everything after 14:00 by 30 minutes" — expect one shift-blocks call.
3. Create a block that overlaps an existing one — expect the coach to announce the conflict rather than silently overwriting.

- [ ] **Step 5: No commit unless formatting fixes required**

---

## Self-review notes (from plan author)

- **Spec coverage:** `updateBlock` (Task 3), `shiftBlocks` both selectors (Tasks 2+4+6+8), overlap on create/update/shift (Tasks 1+3+4+5), coach prompt (Task 10), contract unchanged (no task needed — contract file only covers GETs), test coverage (each task's own test step). Task 11 removes the temporary alias the spec called out.
- **Placeholder scan:** None found. Every code block is complete.
- **Type consistency:** `UpdateBlockPatch`, `ShiftBlocksInput`, `ConflictSummary` types are defined once in `scheduling.service.ts` and referenced by name elsewhere. Tool `inputSchema`s match service method signatures field-for-field.
- **Atomicity:** Each task touches ≤2 files in the same layer; every intermediate commit keeps the build green thanks to the temporary `updateBlockStatus` wrapper that survives through Task 10 and is removed in Task 11.
