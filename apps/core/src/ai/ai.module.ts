import { Module } from "@nestjs/common";
import type { Memory } from "@mastra/memory";
import type { Agent } from "@mastra/core/agent";
import type { PostgresStore } from "@mastra/pg";
import { GoalsModule } from "../goals/goals.module";
import { TasksModule } from "../tasks/tasks.module";
import { SchedulingModule } from "../scheduling/scheduling.module";
import { UsersModule } from "../users/users.module";
import { GoalsService } from "../goals/goals.service";
import { TasksService } from "../tasks/tasks.service";
import { SchedulingService } from "../scheduling/scheduling.service";
import { UsersRepository } from "../users/users.repository";
import { AuthModule } from "../auth/auth.module";
import { env } from "../env";
import { createTools } from "./tools";
import { createMemory, type CreatedMemory } from "./memory";
import { createCoachAgent } from "./agent";
import { createMastra } from "./mastra";
import { AiController, MEMORY } from "./ai.controller";
import { MastraBootstrap, MASTRA, STORE } from "./ai.bootstrap";

export const TOOLS = Symbol("TOOLS");
export const AGENT = Symbol("AGENT");
const MEMORY_BUNDLE = Symbol("MEMORY_BUNDLE");

@Module({
  imports: [
    AuthModule,
    GoalsModule,
    TasksModule,
    SchedulingModule,
    UsersModule,
  ],
  controllers: [AiController],
  providers: [
    {
      provide: TOOLS,
      inject: [GoalsService, TasksService, SchedulingService, UsersRepository],
      useFactory: (
        goals: GoalsService,
        tasks: TasksService,
        scheduling: SchedulingService,
        users: UsersRepository,
      ) => createTools(goals, tasks, scheduling, users),
    },
    {
      provide: MEMORY_BUNDLE,
      useFactory: (): CreatedMemory => createMemory(env.DATABASE_URL),
    },
    {
      provide: STORE,
      inject: [MEMORY_BUNDLE],
      useFactory: (bundle: CreatedMemory) => bundle.store,
    },
    {
      provide: MEMORY,
      inject: [MEMORY_BUNDLE],
      useFactory: (bundle: CreatedMemory) => bundle.memory,
    },
    {
      provide: AGENT,
      inject: [TOOLS, MEMORY],
      useFactory: (tools: Record<string, unknown>, memory: Memory) =>
        createCoachAgent({ tools, memory, model: env.AI_MODEL }),
    },
    {
      provide: MASTRA,
      inject: [AGENT, STORE],
      useFactory: (agent: Agent, store: PostgresStore) =>
        createMastra(agent, store),
    },
    MastraBootstrap,
  ],
})
export class AiModule {}
