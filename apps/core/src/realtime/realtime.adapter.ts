import { IoAdapter } from "@nestjs/platform-socket.io";
import { INestApplicationContext } from "@nestjs/common";
import type { Socket } from "socket.io";
import { ServerOptions, Server } from "socket.io";
import { auth, type AuthSession } from "@consistent/auth";
import { env } from "../env";

type AuthedSocket = Socket & {
  user: AuthSession["user"];
  sessionData: AuthSession["session"];
};

export class AuthenticatedIoAdapter extends IoAdapter {
  constructor(private appContext: INestApplicationContext) {
    super(appContext);
  }

  createIOServer(port: number, options?: Partial<ServerOptions>): Server {
    const server: Server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: env.WEB_ORIGIN,
        credentials: true,
      },
    });

    server.use(async (socket, next) => {
      try {
        const cookieHeader = socket.request.headers.cookie;
        if (!cookieHeader) {
          return next(new Error("No cookies provided"));
        }

        const headers = new Headers();
        headers.set("cookie", cookieHeader);

        const session = await auth.api.getSession({ headers });
        if (!session) {
          return next(new Error("Invalid session"));
        }

        const authed = socket as AuthedSocket;
        authed.user = session.user;
        authed.sessionData = session.session;
        next();
      } catch {
        next(new Error("Authentication failed"));
      }
    });

    return server;
  }
}
