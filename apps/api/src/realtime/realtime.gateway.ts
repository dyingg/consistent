import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { Logger } from "@nestjs/common";

@WebSocketGateway()
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private logger = new Logger(RealtimeGateway.name);

  handleConnection(client: Socket) {
    const user = (client as any).user;
    this.logger.log(
      `Client connected: ${client.id}, user: ${user?.email ?? "unknown"}`,
    );
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage("ping")
  handlePing() {
    return {
      event: "pong",
      data: { type: "pong", timestamp: new Date().toISOString() },
    };
  }
}
