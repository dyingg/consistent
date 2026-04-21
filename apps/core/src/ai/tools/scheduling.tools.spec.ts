/* eslint-disable @typescript-eslint/no-explicit-any --
 * Test mocks legitimately use `any` for two patterns Jest+ts-jest cannot
 * easily type without losing readability:
 *   1. Chainable Drizzle query mocks (e.g. db.select().from().where().limit())
 *      where each step returns the same chainable object — typing this fully
 *      requires recursive generics that obscure the test intent.
 *   2. mockResolvedValue(mockEntity as any) where the literal mock skips
 *      fields like createdAt/updatedAt that the production type requires
 *      but the assertion under test does not care about.
 * Production code in apps/core has the rule at error and is fully clean.
 */

import { BadRequestException } from "@nestjs/common";
import type { SchedulingService } from "../../scheduling/scheduling.service";
import { createSchedulingTools } from "./scheduling.tools";

const mockRequestContext = {
  get: (key: string) => (key === "mastra__resourceId" ? "user-123" : undefined),
  set: jest.fn(),
  has: jest.fn(),
};
const mockContext = { requestContext: mockRequestContext } as any;

describe("scheduling tools", () => {
  const svc = {
    getBlocksForRange: jest.fn(),
    getCurrentBlock: jest.fn(),
    createBlock: jest.fn(),
    bulkCreateBlocks: jest.fn(),
    updateBlock: jest.fn(),
    shiftBlocks: jest.fn(),
    deleteBlock: jest.fn(),
  } as unknown as SchedulingService;

  const tools = createSchedulingTools(svc);

  beforeEach(() => jest.clearAllMocks());

  it("get-schedule converts ISO strings to Date objects", async () => {
    (svc.getBlocksForRange as jest.Mock).mockResolvedValue([]);
    const start = "2026-04-17T00:00:00Z";
    const end = "2026-04-18T00:00:00Z";
    await tools["get-schedule"].execute!({ start, end }, mockContext);
    const [uid, s, e] = (svc.getBlocksForRange as jest.Mock).mock.calls[0];
    expect(uid).toBe("user-123");
    expect(s).toEqual(new Date(start));
    expect(e).toEqual(new Date(end));
  });

  it("get-current-block calls getCurrentBlock with userId", async () => {
    (svc.getCurrentBlock as jest.Mock).mockResolvedValue(null);
    await tools["get-current-block"].execute!({}, mockContext);
    expect(svc.getCurrentBlock).toHaveBeenCalledWith("user-123");
  });

  it("create-blocks normalizes Dates, passes scheduledBy=llm, returns conflicts", async () => {
    (svc.bulkCreateBlocks as jest.Mock).mockResolvedValue({
      blocks: [{ id: 1 }],
      conflicts: [],
    });
    const input = {
      blocks: [
        {
          taskId: 42,
          startTime: "2026-04-17T09:00:00Z",
          endTime: "2026-04-17T10:00:00Z",
        },
      ],
    };
    const result = await tools["create-blocks"].execute!(input, mockContext);
    expect(svc.bulkCreateBlocks).toHaveBeenCalledWith("user-123", [
      {
        taskId: 42,
        startTime: new Date(input.blocks[0]!.startTime),
        endTime: new Date(input.blocks[0]!.endTime),
        scheduledBy: "llm",
      },
    ]);
    expect(result).toEqual({ blocks: [{ id: 1 }], conflicts: [] });
  });

  it("create-blocks forwards multiple entries in a single call", async () => {
    (svc.bulkCreateBlocks as jest.Mock).mockResolvedValue({
      blocks: [{ id: 1 }, { id: 2 }],
      conflicts: [],
    });
    await tools["create-blocks"].execute!(
      {
        blocks: [
          {
            taskId: 1,
            startTime: "2026-04-17T09:00:00Z",
            endTime: "2026-04-17T10:00:00Z",
          },
          {
            taskId: 2,
            startTime: "2026-04-17T10:00:00Z",
            endTime: "2026-04-17T11:00:00Z",
          },
        ],
      },
      mockContext,
    );
    const [uid, blocks] = (svc.bulkCreateBlocks as jest.Mock).mock.calls[0];
    expect(uid).toBe("user-123");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].taskId).toBe(1);
    expect(blocks[1].taskId).toBe(2);
  });

  it("update-block forwards status-only patch to service.updateBlock", async () => {
    (svc.updateBlock as jest.Mock) = jest.fn().mockResolvedValue({
      block: { id: 1 },
      conflicts: [],
    });
    await tools["update-block"].execute!({ blockId: 1, status: "completed" }, mockContext);
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

  it("delete-block calls deleteBlock", async () => {
    (svc.deleteBlock as jest.Mock).mockResolvedValue(undefined);
    await tools["delete-block"].execute!({ blockId: 1 }, mockContext);
    expect(svc.deleteBlock).toHaveBeenCalledWith("user-123", 1);
  });

  it("returns structured error when service throws", async () => {
    (svc.getCurrentBlock as jest.Mock).mockRejectedValue(new Error("boom"));
    const res = await tools["get-current-block"].execute!({}, mockContext);
    expect(res).toEqual({ error: true, message: "boom" });
  });

  it("preserves structured conflict details when service rejects a schedule update", async () => {
    const conflicts = [
      {
        inputIndex: 0,
        kind: "existing",
        blockId: 57,
        taskId: 67,
        taskTitle: "Learn idiomatic Go through focused language drills",
        startTime: "2026-04-22T02:00:00.000Z",
        endTime: "2026-04-22T07:00:00.000Z",
        attemptedBlockId: 58,
        attemptedTaskId: 66,
        attemptedStartTime: "2026-04-22T02:00:00.000Z",
        attemptedEndTime: "2026-04-22T05:00:00.000Z",
      },
    ];
    (svc.updateBlock as jest.Mock).mockRejectedValue(
      new BadRequestException({
        message: "Scheduled block conflicts with existing blocks",
        conflicts,
      }),
    );

    const res = await tools["update-block"].execute!(
      {
        blockId: 58,
        startTime: "2026-04-22T02:00:00.000Z",
        endTime: "2026-04-22T05:00:00.000Z",
      },
      mockContext,
    );

    expect(res).toEqual({
      error: true,
      message: "Scheduled block conflicts with existing blocks",
      conflicts,
    });
  });

  describe("shift-blocks", () => {
    it("forwards explicit blockIds selector", async () => {
      (svc.shiftBlocks as jest.Mock) = jest.fn().mockResolvedValue({
        blocks: [],
        conflicts: [],
      });
      await tools["shift-blocks"].execute!({ blockIds: [1, 2], deltaMinutes: 30 }, mockContext);
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
});
