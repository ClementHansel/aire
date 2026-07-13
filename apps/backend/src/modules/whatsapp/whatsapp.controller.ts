import {
  Controller, Get, Post, Patch, Body, Param, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { WhatsappService } from './whatsapp.service';

/** Public webhook for WAHA/Kapso to deliver inbound messages. */
@Controller('api/whatsapp')
export class WhatsappWebhookController {
  constructor(private readonly service: WhatsappService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(@Body() body: Record<string, any>): Promise<{ ok: true }> {
    // WAHA: { event:'message', session, payload:{ from, body, notifyName } }
    const session: string | undefined = body?.session;
    const p = body?.payload ?? body;
    const from: string | undefined = p?.from ?? p?.chatId ?? p?.sender;
    const text: string | undefined = p?.body ?? p?.text ?? p?.message;
    const name: string | undefined = p?.notifyName ?? p?.senderName ?? p?.name;
    const fromMe: boolean = p?.fromMe ?? false;
    if (from && text && !fromMe) {
      await this.service.handleInbound({ session, from, name, text });
    }
    return { ok: true };
  }
}

/** Authenticated admin endpoints for connection + the Conversation Log. */
@Controller('api/whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TenantOwner)
export class WhatsappController {
  constructor(private readonly service: WhatsappService) {}

  @Get('status') async status(@CurrentUser() u: JWTPayload) {
    const s = await this.service.status(u.tenant_id);
    return { ...s, mock: this.service.isMock() };
  }
  @Post('connect') @HttpCode(HttpStatus.OK) connect(@CurrentUser() u: JWTPayload) { return this.service.ensureSession(u.tenant_id); }
  @Get('qr') qr(@CurrentUser() u: JWTPayload) { return this.service.qr(u.tenant_id); }

  /** Simulation bypass: outbound sends captured while WAHA_MOCK is on. */
  @Get('mock-outbox') mockOutbox(@CurrentUser() u: JWTPayload) { return this.service.listMockOutbox(u.tenant_id); }

  /** Bookings the WhatsApp agent proposed and the customer confirmed, now awaiting staff approval. */
  @Get('pending-approvals') pendingApprovals(@CurrentUser() u: JWTPayload) { return this.service.listPendingApprovals(u.tenant_id); }

  @Post('pending-approvals/:bookingId/decision')
  @HttpCode(HttpStatus.OK)
  decideApproval(@CurrentUser() u: JWTPayload, @Param('bookingId') bookingId: string, @Body() body: { accept: boolean }) {
    return this.service.decidePendingApproval(u.tenant_id, bookingId, !!body.accept, u.sub);
  }

  /** Audit trail: who approved/rejected booking proposals, via which channel, when. */
  @Get('booking-approvals/history') approvalHistory(@CurrentUser() u: JWTPayload) { return this.service.listApprovalHistory(u.tenant_id); }

  @Get('conversations') conversations(@CurrentUser() u: JWTPayload) { return this.service.listConversations(u.tenant_id); }
  @Get('conversations/:id/messages') messages(@CurrentUser() u: JWTPayload, @Param('id') id: string) { return this.service.listMessages(u.tenant_id, id); }

  @Patch('conversations/:id')
  setConv(@CurrentUser() u: JWTPayload, @Param('id') id: string, @Body() body: { aiEnabled?: boolean; status?: string }) {
    return this.service.setConversation(u.tenant_id, id, body);
  }

  @Post('conversations/:id/new-session')
  @HttpCode(HttpStatus.OK)
  newSession(@CurrentUser() u: JWTPayload, @Param('id') id: string) { return this.service.newSession(u.tenant_id, id); }

  @Post('conversations/:id/send')
  @HttpCode(HttpStatus.OK)
  send(@CurrentUser() u: JWTPayload, @Param('id') id: string, @Body() body: { text: string }) {
    return this.service.manualSend(u.tenant_id, id, body.text);
  }

  @Post('conversations/:id/summary')
  @HttpCode(HttpStatus.OK)
  summary(@CurrentUser() u: JWTPayload, @Param('id') id: string) { return this.service.summarize(u.tenant_id, id); }

  /** Demo helper: inject a simulated inbound message (so the log works without a live phone). */
  @Post('simulate-inbound')
  @HttpCode(HttpStatus.OK)
  async simulate(@CurrentUser() u: JWTPayload, @Body() body: { from: string; name?: string; text: string }) {
    await this.service.handleInbound({ tenantId: u.tenant_id, from: body.from, name: body.name, text: body.text });
    return { ok: true };
  }
}
