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
    updateBlockStatus: jest.fn(),
    updateBlock: jest.fn(),
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

  it("create-block normalizes Dates and passes scheduledBy=llm", async () => {
    (svc.createBlock as jest.Mock).mockResolvedValue({ id: 1 });
    const input = {
      taskId: 42,
      startTime: "2026-04-17T09:00:00Z",
      endTime: "2026-04-17T10:00:00Z",
    };
    await tools["create-block"].execute!(input, mockContext);
    expect(svc.createBlock).toHaveBeenCalledWith("user-123", {
      taskId: 42,
      startTime: new Date(input.startTime),
      endTime: new Date(input.endTime),
      scheduledBy: "llm",
    });
  });

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
});
