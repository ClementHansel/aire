import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

export interface OrderStatusChangedPayload {
  orderId: string;
  status: string;
  updatedAt: string;
}

export interface BayStatusChangedPayload {
  bayId: string;
  status: string;
  sensorData?: Record<string, unknown>;
}

export interface QueueUpdatedPayload {
  queue: Array<{
    id: string;
    position: number;
    orderId: string;
    customerName: string;
    status: string;
    estimatedWait?: number;
  }>;
}

export interface PaymentConfirmedPayload {
  orderId: string;
  method: string;
}

export interface AlprDetectionPayload {
  plates: Array<{
    text: string;
    confidence: number;
    cropImageUrl?: string;
  }>;
  cameraId: string;
}

export interface NotificationAlertPayload {
  type: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/',
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join:outlet')
  handleJoinOutlet(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { outletId: string },
  ): { event: string; data: { success: boolean; room: string } } {
    const room = `outlet:${data.outletId}`;
    client.join(room);
    this.logger.log(`Client ${client.id} joined room ${room}`);
    return {
      event: 'join:outlet',
      data: { success: true, room },
    };
  }

  @SubscribeMessage('join:queue-board')
  handleJoinQueueBoard(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { outletId: string },
  ): { event: string; data: { success: boolean; room: string } } {
    const room = `queue-board:${data.outletId}`;
    client.join(room);
    this.logger.log(`Client ${client.id} joined room ${room}`);
    return {
      event: 'join:queue-board',
      data: { success: true, room },
    };
  }

  /**
   * Emit order status change to all clients in the outlet room.
   */
  emitOrderStatusChanged(
    outletId: string,
    payload: OrderStatusChangedPayload,
  ): void {
    this.server
      .to(`outlet:${outletId}`)
      .emit('order:status-changed', payload);
  }

  /**
   * Emit bay status change to all clients in the outlet room.
   */
  emitBayStatusChanged(
    outletId: string,
    payload: BayStatusChangedPayload,
  ): void {
    this.server
      .to(`outlet:${outletId}`)
      .emit('bay:status-changed', payload);
  }

  /**
   * Emit queue update to the queue-board room for the outlet.
   */
  emitQueueUpdated(outletId: string, payload: QueueUpdatedPayload): void {
    this.server
      .to(`queue-board:${outletId}`)
      .emit('queue:updated', payload);
    // Also emit to the outlet room so POS clients see the update
    this.server
      .to(`outlet:${outletId}`)
      .emit('queue:updated', payload);
  }

  /**
   * Emit payment confirmation to the outlet room.
   */
  emitPaymentConfirmed(
    outletId: string,
    payload: PaymentConfirmedPayload,
  ): void {
    this.server
      .to(`outlet:${outletId}`)
      .emit('payment:confirmed', payload);
  }

  /**
   * Emit ALPR detection event to the outlet room.
   */
  emitAlprDetection(
    outletId: string,
    payload: AlprDetectionPayload,
  ): void {
    this.server
      .to(`outlet:${outletId}`)
      .emit('alpr:detection', payload);
  }

  /**
   * Emit notification alert to the outlet room.
   */
  emitNotificationAlert(
    outletId: string,
    payload: NotificationAlertPayload,
  ): void {
    this.server
      .to(`outlet:${outletId}`)
      .emit('notification:alert', payload);
  }
}
