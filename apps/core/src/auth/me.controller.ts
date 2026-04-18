import { Controller, Get, UseGuards } from "@nestjs/common";
import type { AuthUser } from "@consistent/auth";
import { AuthGuard } from "./auth.guard";
import { CurrentUser } from "./auth.decorator";

@Controller({ version: "1" })
export class MeController {
  @Get("me")
  @UseGuards(AuthGuard)
  getMe(@CurrentUser() user: AuthUser) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    };
  }
}
