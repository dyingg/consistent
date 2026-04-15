import { IoAdapter } from "@nestjs/platform-socket.io";
import { INestApplicationContext } from "@nestjs/common";
import { ServerOptions, Server } from "socket.io";
import { auth } from "@consistent/auth";
import { env } from "../env";

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

        (socket as any).user = session.user;
        (socket as any).sessionData = session.session;
        next();
      } catch {
        next(new Error("Authentication failed"));
      }
    });

    return server;
  }
}
