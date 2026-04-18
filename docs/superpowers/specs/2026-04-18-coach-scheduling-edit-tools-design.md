# Coach scheduling edit tools — design

## Problem

The `consistent-coach` agent cannot edit a scheduled block in place. The only write paths today are `create-block`, `update-block` (status only), and `delete-block`. Any time adjustment — "extend this block by an hour," "push everything after lunch by 30 min," "this should have been the other task" — forces a delete+recreate flow. `delete-block` is flagged destructive and requires a confirmation turn, so common coaching moves take two assistant turns and two tool hops.

This is a core responsibility, not an edge case. The coach exists to shape the user's day; the day shifts constantly. Editing must be a single tool hop.

## Goals

- Single tool hop for: changing a block's start, end, status, or task assignment.
- Single tool hop for: shifting N blocks together (disruption recovery).
- Surface overlap conflicts instead of silently creating them or hard-failing.
- No new delete-confirmation turns for normal time edits.

## Non-goals

- Splitting one block into two.
- Copying yesterday's schedule forward.
- Recurring blocks.
- Conflict *resolution* logic (agent decides, server only reports overlaps).

## Design

### 1. Partial update on `update-block`

Expand the tool, service, repository, controller, and route to accept any subset of `{ status, startTime, endTime, taskId }`.

- Validate `start < end` using the *effective* values — fetch the current block, overlay the patch, then check. The ownership check already fetches the row, so reuse it.
- If `taskId` changes, verify the new task belongs to the user (same check `createBlock` uses).
- Emit `schedule:updated` once per call.
- Response shape changes from `Block` to `{ block: Block, conflicts: ConflictSummary[] }` (see §3).

### 2. New `shift-blocks` tool

Coaching primitive: shift multiple blocks together in a single tool hop, one transaction, one broadcast.

**Input shape — accept either selector, mutually exclusive:**

```ts
{
  deltaMinutes: number,        // required, may be negative
  blockIds?: number[],         // explicit selection
  afterTime?: string,          // ISO 8601; shifts all blocks where startTime >= afterTime
}
```

Semantics of `afterTime`: filter is `startTime >= afterTime` — a block that started *before* `afterTime` but is still running is not shifted. This matches the "past is fixed, reshape the future" coaching intent.

Validation: exactly one of `blockIds` / `afterTime` must be present; `deltaMinutes !== 0`. Ownership enforced for every affected block. The shift is applied in a transaction so partial failures don't leave the schedule half-shifted.

Response: `{ blocks: Block[], conflicts: ConflictSummary[] }`. `blocks` ordered ascending by (new) `startTime`.

**Tool description must make the dual shape explicit** so the agent picks the right selector without extra prompting. Draft:

> Shift one or more blocks forward or backward in time by `deltaMinutes`. Use `blockIds` when you already know which blocks to move (e.g., the ones you just listed to the user). Use `afterTime` when the user's day was disrupted and everything from a point onward should slide — this saves a `get-schedule` call. Exactly one selector must be provided. All shifted blocks belong to the user; ownership is enforced server-side.

### 3. Overlap detection (soft)

A new repository method `findOverlapping(userId, start, end, excludeId?)` returns blocks whose `[startTime, endTime)` intersects the given range. The existing `idx_scheduled_blocks_user_time` composite index on `(user_id, start_time, end_time)` covers this query; one SELECT per create/update call. For `shiftBlocks`, `excludeId` becomes an `excludeIds` array so the cohort can exclude itself in one call.

Wrap results as:

```ts
type ConflictSummary = {
  blockId: number;
  taskId: number;
  taskTitle: string;
  startTime: string;
  endTime: string;
};
```

Returned from `createBlock`, `updateBlock`, and `shiftBlocks`. `shiftBlocks` computes conflicts on the *post-shift* ranges and excludes the shifting cohort from itself (shifting 3 contiguous blocks by 30 min shouldn't report them as conflicting with each other — they all move together).

**The server never rejects for overlap.** The coach is responsible for deciding what to do.

### 4. Coach prompt

One short paragraph added to `prompts/coach.ts`:

> When you update or create a block and the response includes `conflicts`, tell the user which existing block(s) overlap and ask how to resolve it before moving on — don't silently overwrite. If you just shifted a cohort and something downstream now conflicts, offer to shift that too.

Keep byte-stable per the existing prompt-cache constraint (append, don't rewrite).

### 5. API surface

| Change | Endpoint | Body |
|---|---|---|
| expand | `PATCH /v1/schedule/blocks/:id` | `{ status?, startTime?, endTime?, taskId? }` |
| new | `POST /v1/schedule/blocks/shift` | `{ deltaMinutes, blockIds? \| afterTime? }` |

Responses for both, and for existing `POST /v1/schedule/blocks`, grow a `conflicts` field. Existing callers reading only `block`/top-level fields keep working.

### 6. Tool surface

| Tool | Change |
|---|---|
| `update-block` | inputs: add optional `startTime`, `endTime`, `taskId`; make `status` optional. Description updated to note partial update. |
| `shift-blocks` | new, as §2. |
| `create-block` | unchanged inputs; response now includes `conflicts`. |
| `delete-block` | unchanged — still destructive, still requires prior confirmation. |

## Data flow

```
coach tool call
  → SchedulingService.updateBlock / shiftBlocks / createBlock
    → ownership + task-ownership + start<end validation
    → SchedulingRepository.updateBlock / shiftBlocks (tx) / createBlock
    → SchedulingRepository.findOverlapping
    → RealtimeGateway.broadcastToUser(userId, SCHEDULE_UPDATED)
  → tool returns { block | blocks, conflicts }
```

## Error handling

- `start >= end` after applying patch → `BadRequestException` ("Start time must be before end time"). Existing behavior.
- `taskId` not owned by user → `NotFoundException` ("Task not found"). Matches `createBlock`.
- `blockId` not owned → `NotFoundException` ("Scheduled block not found"). Existing behavior.
- `shiftBlocks`: any block not owned → `NotFoundException` referencing the offending id; whole transaction aborts.
- `shiftBlocks`: neither/both of `blockIds`/`afterTime` → `BadRequestException` ("Provide exactly one of blockIds or afterTime").
- `shiftBlocks`: `deltaMinutes === 0` → `BadRequestException` ("deltaMinutes must be non-zero").
- Overlap → never an error. Surfaced in `conflicts`.

## Testing

Service specs (`scheduling.service.spec.ts`):
- `updateBlock` with each field alone (status, startTime, endTime, taskId)
- `updateBlock` with combined fields
- `updateBlock` rejects `start >= end` (overlay case: only `endTime` passed, new end < existing start)
- `updateBlock` rejects `taskId` the user doesn't own
- `updateBlock` returns conflicts excluding the block itself
- `shiftBlocks` with `blockIds`
- `shiftBlocks` with `afterTime`
- `shiftBlocks` rejects both-selectors / neither-selector / zero-delta
- `shiftBlocks` aborts transactionally when one block isn't owned
- `shiftBlocks` conflict report excludes the shifted cohort from itself

Tool specs (`scheduling.tools.spec.ts`):
- `update-block` forwards each field; omitted fields not passed
- `shift-blocks` forwards each selector shape
- Both return `conflicts` from the service

Repository specs (`scheduling.repository.spec.ts`):
- `updateBlock` partial column set
- `shiftBlocks` atomic update
- `findOverlapping` inclusive start / exclusive end semantics; `excludeId` works

## Migration / backwards-compat notes

- No schema changes.
- `SchedulingRepository.updateBlockStatus` can be removed; call sites migrate to `updateBlock({ status })`.
- REST PATCH body widens; existing clients sending only `{ status }` keep working.
- Response shape widens (adds `conflicts`); existing clients ignoring unknown fields keep working.

## Rollout

Single branch, atomic commits per layer (repo → service → controller → tool → prompt → tests), in that order so each commit typechecks and tests pass.
