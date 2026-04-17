import { GoalsService } from "../../goals/goals.service";
import { TasksService } from "../../tasks/tasks.service";
import { SchedulingService } from "../../scheduling/scheduling.service";
import type { UsersRepository } from "../../users/users.repository";
import { createTools } from "./index";

const mockUsersRepository = {
  findById: jest.fn().mockResolvedValue({ id: "user-123", timezone: "UTC" }),
  findByEmail: jest.fn(),
  updatePreferences: jest.fn(),
  updateTimezone: jest.fn(),
} as unknown as UsersRepository;

describe("createTools", () => {
  const mockGoalsService = {
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    getProgress: jest.fn(),
  } as unknown as GoalsService;

  const mockTasksService = {
    findAllForGoal: jest.fn(),
    findReadyForUser: jest.fn(),
    getGoalDag: jest.fn(),
    create: jest.fn(),
    bulkCreate: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  } as unknown as TasksService;

  const mockSchedulingService = {
    getBlocksForRange: jest.fn(),
    getCurrentBlock: jest.fn(),
    createBlock: jest.fn(),
    updateBlockStatus: jest.fn(),
    deleteBlock: jest.fn(),
  } as unknown as SchedulingService;

  const tools = createTools(
    mockGoalsService,
    mockTasksService,
    mockSchedulingService,
    mockUsersRepository,
  );

  it("should create all 17 tools", () => {
    expect(Object.keys(tools)).toHaveLength(17);
  });

  it("should include the time tool", () => {
    expect(tools["get-current-time"]).toBeDefined();
  });

  it("should include all goal tools", () => {
    expect(tools["get-goals"]).toBeDefined();
    expect(tools["create-goal"]).toBeDefined();
    expect(tools["update-goal"]).toBeDefined();
    expect(tools["delete-goal"]).toBeDefined();
  });

  it("should include all task tools", () => {
    expect(tools["get-tasks"]).toBeDefined();
    expect(tools["get-ready-tasks"]).toBeDefined();
    expect(tools["get-goal-dag"]).toBeDefined();
    expect(tools["create-task"]).toBeDefined();
    expect(tools["bulk-create-tasks"]).toBeDefined();
    expect(tools["update-task"]).toBeDefined();
    expect(tools["delete-task"]).toBeDefined();
  });

  it("should include all schedule tools", () => {
    expect(tools["get-schedule"]).toBeDefined();
    expect(tools["get-current-block"]).toBeDefined();
    expect(tools["create-block"]).toBeDefined();
    expect(tools["update-block"]).toBeDefined();
    expect(tools["delete-block"]).toBeDefined();
  });
});

describe("goal tool execution", () => {
  const mockGoalsService = {
    findAll: jest.fn().mockResolvedValue([
      { id: 1, title: "Test Goal", progress: 50 },
    ]),
    create: jest.fn().mockResolvedValue({ id: 1, title: "New Goal" }),
    update: jest.fn().mockResolvedValue({ id: 1, title: "Updated Goal" }),
    delete: jest.fn().mockResolvedValue(undefined),
  } as unknown as GoalsService;

  const mockTasksService = {} as unknown as TasksService;
  const mockSchedulingService = {} as unknown as SchedulingService;

  const tools = createTools(
    mockGoalsService,
    mockTasksService,
    mockSchedulingService,
    mockUsersRepository,
  );

  // RequestContext uses a Map internally; mock the .get() interface
  const mockRequestContext = {
    get: jest.fn((key: string) => {
      if (key === "mastra__resourceId") return "user-123";
      return undefined;
    }),
    set: jest.fn(),
    has: jest.fn(),
  };

  const mockContext = {
    requestContext: mockRequestContext,
  } as any;

  beforeEach(() => jest.clearAllMocks());

  it("get-goals should call goalsService.findAll with userId", async () => {
    const result = await tools["get-goals"].execute({ status: "active" }, mockContext);
    expect(mockGoalsService.findAll).toHaveBeenCalledWith("user-123", "active");
    expect(result).toEqual({ goals: [{ id: 1, title: "Test Goal", progress: 50 }] });
  });

  it("create-goal should call goalsService.create with userId and data", async () => {
    const input = { title: "New Goal", description: "A goal" };
    await tools["create-goal"].execute(input, mockContext);
    expect(mockGoalsService.create).toHaveBeenCalledWith("user-123", input);
  });

  it("delete-goal should call goalsService.delete with userId and goalId", async () => {
    await tools["delete-goal"].execute({ goalId: 1 }, mockContext);
    expect(mockGoalsService.delete).toHaveBeenCalledWith("user-123", 1);
  });
});
