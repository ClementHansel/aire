import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, UseGuards, HttpCode, HttpStatus, Logger,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { WhatsappService } from './whatsapp.service';
import { WaWhitelistService, type WhitelistInput } from './wa-whitelist.service';

/** Public webhook for WAHA/kirimdev to deliver inbound messages. */
@Controller('api/whatsapp')
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);
  constructor(private readonly service: WhatsappService) {}

  /**
   * Tokenised WAHA webhook: `/api/whatsapp/webhook/<wa_webhook_token>`.
   *
   * The token (migration 103) is what identifies the line. The old tokenless
   * route below is a public endpoint that trusted a guessable session name, so
   * anyone on the internet could inject inbound messages into a tenant's agent;
   * and with one WAHA Core container per tenant, every gateway reports the
   * session name 'default', so the name cannot tell tenants apart either.
   * Configure each gateway's WHATSAPP_HOOK_URL with its own token.
   */
  @Post('webhook/:token')
  @HttpCode(HttpStatus.OK)
  tokenWebhook(@Param('token') token: string, @Body() body: Record<string, any>): { ok: true } {
    return this.webhook(body, token);
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  webhook(@Body() body: Record<string, any>, token?: string): { ok: true } {
    // WAHA: { event:'message', session, payload:{ from, body, notifyName, participant, _data… } }
    const session: string | undefined = body?.session;
    const event: string | undefined = typeof body?.event === 'string' ? body.event : undefined;
    // WAHA emits a family of events on the same hook URL. Only a new inbound
    // message is a reason to run the agent: `message.any` is the same message
    // echoed (including our own sends), and `message.ack`/`message.reaction`/
    // `message.revoked` are not messages at all. Subscribing to more than one of
    // these is a supported WAHA configuration, and it used to mean the customer
    // got an extra reply per extra event. An absent `event` is treated as a
    // message so a gateway that posts a bare payload keeps working.
    if (event && event !== 'message') return { ok: true };
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
    // The gateway's own id for this message, used to drop re-deliveries. WEBJS
    // reports a serialised id string, NOWEB a nested object.
    const messageId: string | null = firstString(
      p?.id,
      p?.id?._serialized,
      p?._data?.id?._serialized,
      p?.key?.id,
    );
    // ACK the gateway IMMEDIATELY and process in the background. The agent's
    // LLM tool-loop can take many seconds (esp. bookings); if we held the
    // connection open, WAHA/nginx would time out (504) and WAHA would retry,
    // causing duplicate replies. Fire-and-forget with error logging instead.
    if (from && text && !fromMe) {
      void this.service
        .handleInbound({ token, session, from, name, text, isGroup, author, mentions, messageId })
        .catch((err) => this.logger.error(`handleInbound failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    return { ok: true };
  }

  /**
   * kirimdev inbound webhook: forwards Meta's exact WhatsApp Cloud API
   * envelope (entry[].changes[].value.messages[]). Signature verification
   * needs the RAW request bytes (main.ts enables `rawBody: true` app-wide),
   * so this reads req.rawBody rather than the parsed @Body().
   *
   * On a bad/missing signature we still ACK 200 and drop the payload —
   * returning 4xx here would make a legitimate-looking sender (or an
   * attacker) retry-storm the endpoint; silently dropping is safer for a
   * public webhook than surfacing the failure to the caller.
   *
   * On success we ACK immediately and process in the background (same
   * fire-and-forget rationale as the WAHA handler above): the agent's LLM
   * tool-loop can take many seconds, and holding the webhook connection open
   * risks a gateway timeout + retry, which would duplicate replies.
   */
  @Post('kirim-webhook')
  @HttpCode(HttpStatus.OK)
  kirimWebhook(@Req() req: RawBodyRequest<Request>, @Body() body: Record<string, any>): { ok: true } {
    const raw = req.rawBody?.toString('utf8') ?? '';
    const sig = req.headers['x-kirim-signature'] as string | undefined;
    if (!this.service.verifyKirimSignature(raw, sig)) {
      this.logger.warn('kirim webhook: signature verification failed; dropping payload');
      return { ok: true };
    }
    void this.service
      .handleKirimWebhook(body)
      .catch((err) => this.logger.error(`handleKirimWebhook failed: ${err instanceof Error ? err.message : String(err)}`));
    return { ok: true };
  }
}

/** First candidate that is actually a non-empty string, else null. */
function firstString(...candidates: unknown[]): string | null {
  for (const c of candidates) if (typeof c === 'string' && c.trim() !== '') return c;
  return null;
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
  constructor(
    private readonly service: WhatsappService,
    private readonly whitelist: WaWhitelistService,
  ) {}

  // ─── Staff whitelist ──────────────────────────────────────────────────────
  // Numbers that reach the FULL business agent instead of the customer bot.
  // Owner-only (the class-level @Roles gate): each row grants access to the
  // tenant's business data from a phone.

  @Get('whitelist') listWhitelist(@CurrentUser() u: JWTPayload) {
    return this.whitelist.list(u.tenant_id);
  }

  @Post('whitelist')
  @HttpCode(HttpStatus.CREATED)
  addWhitelist(@CurrentUser() u: JWTPayload, @Body() body: WhitelistInput) {
    return this.whitelist.create(u.tenant_id, body ?? {}, u.sub);
  }

  @Patch('whitelist/:id')
  updateWhitelist(@CurrentUser() u: JWTPayload, @Param('id') id: string, @Body() body: WhitelistInput) {
    return this.whitelist.update(u.tenant_id, id, body ?? {});
  }

  @Delete('whitelist/:id')
  removeWhitelist(@CurrentUser() u: JWTPayload, @Param('id') id: string) {
    return this.whitelist.remove(u.tenant_id, id);
  }

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
