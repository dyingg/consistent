import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { auth, type AuthSession } from "@consistent/auth";
import { fromNodeHeaders } from "better-auth/node";
import type { Request as ExpressRequest } from "express";

type AuthedRequest = ExpressRequest & {
  user: AuthSession["user"];
  session: AuthSession["session"];
};

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });

    if (!session) {
      throw new UnauthorizedException();
    }

    request.session = session.session;
    request.user = session.user;
    return true;
  }
}
