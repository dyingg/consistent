import { Controller, Get } from "@nestjs/common";

@Controller({ version: "1" })
export class VersionController {
  @Get("version")
  getVersion() {
    return { version: "0.0.0" };
  }
}
