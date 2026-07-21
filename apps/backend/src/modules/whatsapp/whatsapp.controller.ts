import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards, HttpCode, HttpStatus, Logger,
} from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { WhatsappService } from './whatsapp.service';

/** Public webhook for WAHA/Kapso to deliver inbound messages. */
@Controller('api/whatsapp')
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);
  constructor(private readonly service: WhatsappService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  webhook(@Body() body: Record<string, any>): { ok: true } {
    // WAHA: { event:'message', session, payload:{ from, body, notifyName, participant, _data… } }
    const session: string | undefined = body?.session;
    const p = body?.payload ?? body;
    const from: string | undefined = p?.from ?? p?.chatId ?? p?.sender;
    const text: string | undefined = p?.body ?? p?.text ?? p?.message;
    const name: string | undefined = p?.notifyName ?? p?.senderName ?? p?.name;
    const fromMe: boolean = p?.fromMe ?? p?._data?.fromMe ?? false;
    // Group chats: `from` is the group JID (…@g.us) and the real sender is the
    // participant. The service only engages in groups when the bot is @mentioned
    // (otherwise it would reply to all group chatter); DMs always pass.
    const isGroup = typeof from === 'string' && from.endsWith('@g.us');
    const author: string | undefined =
      p?.participant ?? p?.author ?? p?._data?.author ?? p?._data?.participant ?? undefined;
    const mentions = extractMentions(p);
    // ACK the gateway IMMEDIATELY and process in the background. The agent's
    // LLM tool-loop can take many seconds (esp. bookings); if we held the
    // connection open, WAHA/nginx would time out (504) and WAHA would retry,
    // causing duplicate replies. Fire-and-forget with error logging instead.
    if (from && text && !fromMe) {
      void this.service
        .handleInbound({ session, from, name, text, isGroup, author, mentions })
        .catch((err) => this.logger.error(`handleInbound failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    return { ok: true };
  }
}

/** Pull mentioned WhatsApp ids from the various shapes WAHA engines emit (WEBJS vs NOWEB). */
function extractMentions(p: Record<string, any> | undefined): string[] {
  if (!p) return [];
  const out: string[] = [];
  const push = (v: unknown) => {
    if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') out.push(x);
  };
  push(p.mentionedIds);
  push(p.mentions);
  push(p._data?.mentionedJidList);
  push(p._data?.message?.extendedTextMessage?.contextInfo?.mentionedJid);
  push(p.message?.extendedTextMessage?.contextInfo?.mentionedJid);
  return out;
}

/** Authenticated admin endpoints for connection + the Conversation Log. */
@Controller('api/whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TenantOwner)
export class WhatsappController {
  constructor(private readonly service: WhatsappService) {}

  // outletId (optional) targets a specific branch line when per-branch WhatsApp
  // is on; omit it for the tenant central line.
  @Get('status') async status(@CurrentUser() u: JWTPayload, @Query('outletId') outletId?: string) {
    const s = await this.service.status(u.tenant_id, outletId || null);
    return { ...s, mock: await this.service.isMockEnabled(u.tenant_id) };
  }
  @Post('connect') @HttpCode(HttpStatus.OK) connect(@CurrentUser() u: JWTPayload, @Body() body: { outletId?: string }) { return this.service.ensureSession(u.tenant_id, body?.outletId || null); }
  @Get('qr') qr(@CurrentUser() u: JWTPayload, @Query('outletId') outletId?: string) { return this.service.qr(u.tenant_id, outletId || null); }

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
  async simulate(@CurrentUser() u: JWTPayload, @Body() body: { from: string; name?: string; text: string; outletId?: string }) {
    await this.service.handleInbound({ tenantId: u.tenant_id, outletId: body.outletId || null, from: body.from, name: body.name, text: body.text });
    return { ok: true };
  }
}
