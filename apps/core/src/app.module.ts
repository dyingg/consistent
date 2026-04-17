import { Module } from "@nestjs/common";
import { DrizzleModule } from "./db";
import { AuthModule } from "./auth/auth.module";
import { HealthModule } from "./health/health.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { UsersModule } from "./users/users.module";
import { GoalsModule } from "./goals/goals.module";
import { TasksModule } from "./tasks/tasks.module";
import { SchedulingModule } from "./scheduling/scheduling.module";
import { AiModule } from "./ai/ai.module";

@Module({
  imports: [
    DrizzleModule,
    AuthModule,
    HealthModule,
    RealtimeModule,
    UsersModule,
    GoalsModule,
    TasksModule,
    SchedulingModule,
    AiModule,
  ],
})
export class AppModule {}
