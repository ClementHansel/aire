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
import type { ActionProposal } from './agent.types';

/**
 * Payload emitted when a new proposal is created.
 */
export interface ProposalCreatedPayload {
  proposal: ActionProposal;
}

/**
 * Payload emitted when a proposal is resolved (approved/rejected/expired).
 */
export interface ProposalResolvedPayload {
  proposalId: string;
  status: 'approved' | 'rejected' | 'expired';
  resolvedBy: string;
  resolvedAt: string;
}

/**
 * Agent WebSocket Gateway.
 *
 * Provides real-time notifications for action proposals.
 * Tenants join a room by tenant_id to receive proposal events.
 *
 * Events:
 * - `proposal:created` — emitted when a new proposal is created
 * - `proposal:resolved` — emitted when a proposal is approved/rejected/expired
 *
 * Client messages:
 * - `join:tenant` — join a tenant-scoped room for proposal notifications
 *
 * Requirements: 6.3, 6.4, 6.5
 */
@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/agent',
})
export class AgentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(AgentGateway.name);

  handleConnection(client: Socket): void {
    this.logger.log(`Agent WS client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Agent WS client disconnected: ${client.id}`);
  }

  /**
   * Handle client request to join a tenant room for proposal notifications.
   */
  @SubscribeMessage('join:tenant')
  handleJoinTenant(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { tenantId: string },
  ): { event: string; data: { success: boolean; room: string } } {
    const room = `tenant:${data.tenantId}`;
    client.join(room);
    this.logger.log(`Client ${client.id} joined agent room ${room}`);
    return {
      event: 'join:tenant',
      data: { success: true, room },
    };
  }

  /**
   * Emit a proposal:created event to all clients in the tenant room.
   * Called by ProposalService or AgentService when a new proposal is created.
   */
  emitProposalCreated(tenantId: string, payload: ProposalCreatedPayload): void {
    this.server.to(`tenant:${tenantId}`).emit('proposal:created', payload);
    this.logger.log(
      `Emitted proposal:created for tenant ${tenantId} (proposal=${payload.proposal.id})`,
    );
  }

  /**
   * Emit a proposal:resolved event to all clients in the tenant room.
   * Called by AgentController when a proposal is approved or rejected.
   */
  emitProposalResolved(tenantId: string, payload: ProposalResolvedPayload): void {
    this.server.to(`tenant:${tenantId}`).emit('proposal:resolved', payload);
    this.logger.log(
      `Emitted proposal:resolved for tenant ${tenantId} (proposal=${payload.proposalId}, status=${payload.status})`,
    );
  }
}
