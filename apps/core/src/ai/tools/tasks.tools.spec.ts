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
import type { TasksService } from "../../tasks/tasks.service";
import { createTaskTools } from "./tasks.tools";

const mockRequestContext = {
  get: (key: string) => (key === "mastra__resourceId" ? "user-123" : undefined),
  set: jest.fn(),
  has: jest.fn(),
};
const mockContext = { requestContext: mockRequestContext } as any;

describe("task tools", () => {
  const svc = {
    findAllForGoal: jest.fn(),
    findReadyForUser: jest.fn(),
    getGoalDag: jest.fn(),
    create: jest.fn(),
    bulkCreate: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    bulkDelete: jest.fn(),
  } as unknown as TasksService;

  const tools = createTaskTools(svc);

  beforeEach(() => jest.clearAllMocks());

  it("get-tasks calls findAllForGoal with userId + goalId", async () => {
    (svc.findAllForGoal as jest.Mock).mockResolvedValue([{ id: 1 }]);
    const res = await tools["get-tasks"].execute!({ goalId: 7 }, mockContext);
    expect(svc.findAllForGoal).toHaveBeenCalledWith("user-123", 7);
    expect(res).toEqual({ tasks: [{ id: 1 }] });
  });

  it("get-ready-tasks calls findReadyForUser with userId", async () => {
    (svc.findReadyForUser as jest.Mock).mockResolvedValue([]);
    await tools["get-ready-tasks"].execute!({}, mockContext);
    expect(svc.findReadyForUser).toHaveBeenCalledWith("user-123");
  });

  it("get-goal-dag calls getGoalDag with userId + goalId", async () => {
    (svc.getGoalDag as jest.Mock).mockResolvedValue({ tasks: [], edges: [] });
    await tools["get-goal-dag"].execute!({ goalId: 7 }, mockContext);
    expect(svc.getGoalDag).toHaveBeenCalledWith("user-123", 7);
  });

  it("create-task calls create(userId, goalId, data)", async () => {
    (svc.create as jest.Mock).mockResolvedValue({ id: 1 });
    await tools["create-task"].execute!(
      { goalId: 7, title: "T", sprintPoints: 3 },
      mockContext,
    );
    expect(svc.create).toHaveBeenCalledWith("user-123", 7, {
      title: "T",
      sprintPoints: 3,
    });
  });

  it("create-task converts ISO date strings to Date objects", async () => {
    (svc.create as jest.Mock).mockResolvedValue({ id: 1 });
    const iso = "2026-05-01T09:00:00Z";
    await tools["create-task"].execute!(
      { goalId: 7, title: "T", earliestStart: iso, deadline: iso },
      mockContext,
    );
    const [, , data] = (svc.create as jest.Mock).mock.calls[0];
    expect(data.earliestStart).toEqual(new Date(iso));
    expect(data.deadline).toEqual(new Date(iso));
  });

  it("bulk-create-tasks calls bulkCreate(userId, goalId, { tasks, dependencies })", async () => {
    (svc.bulkCreate as jest.Mock).mockResolvedValue({ tasks: [], edges: [] });
    const input = {
      goalId: 7,
      tasks: [{ title: "A", sprintPoints: 1 }],
      dependencies: [{ fromIndex: 0, toIndex: 0 }],
    };
    await tools["bulk-create-tasks"].execute!(input, mockContext);
    expect(svc.bulkCreate).toHaveBeenCalledWith("user-123", 7, {
      tasks: input.tasks,
      dependencies: input.dependencies,
    });
  });

  it("update-task calls update(userId, taskId, patch) without taskId in patch", async () => {
    (svc.update as jest.Mock).mockResolvedValue({ id: 1 });
    await tools["update-task"].execute!(
      { taskId: 1, title: "new" },
      mockContext,
    );
    expect(svc.update).toHaveBeenCalledWith("user-123", 1, { title: "new" });
  });

  it("delete-task calls bulkDelete with userId + taskIds", async () => {
    (svc.bulkDelete as jest.Mock).mockResolvedValue({
      deletedIds: [1, 2],
      count: 2,
    });
    const res = await tools["delete-task"].execute!(
      { taskIds: [1, 2] },
      mockContext,
    );
    expect(svc.bulkDelete).toHaveBeenCalledWith("user-123", [1, 2]);
    expect(res).toEqual({ deletedIds: [1, 2], count: 2 });
  });

  it("delete-task accepts a single id wrapped in an array", async () => {
    (svc.bulkDelete as jest.Mock).mockResolvedValue({
      deletedIds: [42],
      count: 1,
    });
    await tools["delete-task"].execute!({ taskIds: [42] }, mockContext);
    expect(svc.bulkDelete).toHaveBeenCalledWith("user-123", [42]);
  });

  it("returns structured error when service throws", async () => {
    (svc.findAllForGoal as jest.Mock).mockRejectedValue(new Error("boom"));
    const res = await tools["get-tasks"].execute!({ goalId: 7 }, mockContext);
    expect(res).toEqual({ error: true, message: "boom" });
  });
});