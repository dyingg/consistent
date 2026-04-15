import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { HealthModule } from "./health/health.module";
import { RealtimeModule } from "./realtime/realtime.module";

@Module({
  imports: [AuthModule, HealthModule, RealtimeModule],
})
export class AppModule {}
