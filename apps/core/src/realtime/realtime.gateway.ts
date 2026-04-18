import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { Logger } from "@nestjs/common";
import type { AuthUser } from "@consistent/auth";

// AuthenticatedIoAdapter attaches user/sessionData onto every connecting
// socket. Mirror that shape here so handleConnection doesn't have to cast.
type AuthedSocket = Socket & { user?: AuthUser };

@WebSocketGateway()
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private logger = new Logger(RealtimeGateway.name);

  handleConnection(client: AuthedSocket) {
    const user = client.user;
    this.logger.log(
      `Client connected: ${client.id}, user: ${user?.email ?? "unknown"}`,
    );
    if (user?.id) {
      client.join(`user:${user.id}`);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  broadcastToUser(userId: string, event: string, payload: unknown) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  @SubscribeMessage("ping")
  handlePing() {
    return {
      event: "pong",
      data: { type: "pong", timestamp: new Date().toISOString() },
    };
  }
}
