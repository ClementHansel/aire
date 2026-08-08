import {
  Controller, Get, Put, Delete, Post, Param, Body, UseGuards, BadRequestException,
} from '@nestjs/common';
import { Role, JWTPayload } from '@aire/shared';
import { Roles, CurrentUser } from '../../common/decorators';
import { RolesGuard, RlsContextGuard } from '../../common/guards';
import { JwtAuthGuard } from '../auth/auth.guard';
import { NotificationRendererService, fillForKey, sampleVars, type TemplateView } from './notification-renderer.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { CATEGORY_LABELS, AUDIENCE_LABELS, getDefinition, unknownPlaceholders } from './notification-catalog';

interface SaveTemplateDto {
  body?: string | null;
  enabled?: boolean;
}

/** Longest a single WhatsApp text message can be before providers start splitting it. */
const MAX_BODY_CHARS = 3000;

/**
 * Owner-facing management of notification texts.
 *
 * The catalogue itself is code (notification-catalog.ts); these endpoints expose
 * it merged with the tenant's overrides so the settings UI can list, edit,
 * disable, reset and test-send each message.
 */
@Controller('api/notification-templates')
@UseGuards(JwtAuthGuard, RlsContextGuard, RolesGuard)
@Roles(Role.TenantOwner)
export class NotificationTemplateController {
  constructor(
    private readonly renderer: NotificationRendererService,
    private readonly whatsapp: WhatsappService,
  ) {}

  /**
   * GET /api/notification-templates/:tenantId
   *
   * Every notification the platform can send, with this tenant's wording and
   * on/off state. Category and audience labels ride along so the UI does not
   * duplicate the translation table.
   */
  @Get(':tenantId')
  async list(@Param('tenantId') tenantId: string): Promise<{
    templates: TemplateView[];
    categoryLabels: Record<string, string>;
    audienceLabels: Record<string, string>;
  }> {
    return {
      templates: await this.renderer.listForTenant(tenantId),
      categoryLabels: CATEGORY_LABELS,
      audienceLabels: AUDIENCE_LABELS,
    };
  }

  /**
   * PUT /api/notification-templates/:tenantId/:key
   *
   * Save wording and/or the on/off switch. Rejects a body that uses a variable
   * this notification does not provide — otherwise `{namaPelanggan}` would be
   * delivered to a customer verbatim.
   */
  @Put(':tenantId/:key')
  async save(
    @Param('tenantId') tenantId: string,
    @Param('key') key: string,
    @CurrentUser() user: JWTPayload,
    @Body() dto: SaveTemplateDto,
  ): Promise<{ ok: true }> {
    const def = this.definitionOr404(key);

    if (dto.body !== undefined && dto.body !== null) {
      if (def.lockedReason) {
        throw new BadRequestException(def.lockedReason);
      }
      const body = dto.body.trim();
      if (!body) throw new BadRequestException('Isi notifikasi tidak boleh kosong.');
      if (body.length > MAX_BODY_CHARS) {
        throw new BadRequestException(`Isi notifikasi terlalu panjang (maksimal ${MAX_BODY_CHARS} karakter).`);
      }
      const unknown = unknownPlaceholders(key, body);
      if (unknown.length > 0) {
        throw new BadRequestException(
          `Variabel tidak dikenal: ${unknown.map((u) => `{${u}}`).join(', ')}. ` +
            `Gunakan hanya: ${def.variables.map((v) => `{${v.name}}`).join(', ') || '(tidak ada variabel)'}.`,
        );
      }
    }

    if (dto.enabled === false && !def.canDisable) {
      throw new BadRequestException('Notifikasi ini tidak dapat dimatikan karena dibutuhkan oleh alur transaksi.');
    }

    await this.renderer.save(tenantId, key, { body: dto.body ?? null, enabled: dto.enabled }, user.sub);
    return { ok: true };
  }

  /** DELETE /api/notification-templates/:tenantId/:key — back to the stock text. */
  @Delete(':tenantId/:key')
  async reset(@Param('tenantId') tenantId: string, @Param('key') key: string): Promise<{ ok: true }> {
    this.definitionOr404(key);
    await this.renderer.reset(tenantId, key);
    return { ok: true };
  }

  /**
   * POST /api/notification-templates/:tenantId/:key/preview
   *
   * Render an unsaved draft with the sample values, so the owner sees the real
   * message — including which lines disappear — before committing.
   */
  @Post(':tenantId/:key/preview')
  async preview(
    @Param('key') key: string,
    @Body() dto: { body?: string },
  ): Promise<{ preview: string; unknownVariables: string[] }> {
    const def = this.definitionOr404(key);
    const body = dto.body?.trim() ? dto.body : def.defaultBody;
    return {
      preview: fillForKey(key, body, sampleVars(def)),
      unknownVariables: unknownPlaceholders(key, body),
    };
  }

  /**
   * POST /api/notification-templates/:tenantId/:key/test
   *
   * Send the current wording (filled with sample values) to a real number, so
   * the owner can check formatting on an actual phone.
   */
  @Post(':tenantId/:key/test')
  async test(
    @Param('tenantId') tenantId: string,
    @Param('key') key: string,
    @Body() dto: { phone?: string; body?: string },
  ): Promise<{ sent: boolean; reason?: string }> {
    const def = this.definitionOr404(key);
    const phone = (dto.phone ?? '').trim();
    if (!phone) throw new BadRequestException('Masukkan nomor WhatsApp tujuan uji coba.');

    const body = dto.body?.trim() ? dto.body : def.defaultBody;
    const text = `🧪 *Uji coba notifikasi*\n\n${fillForKey(key, body, sampleVars(def))}`;
    const sent = await this.whatsapp.sendText(tenantId, phone, text).catch(() => false);
    return sent
      ? { sent: true }
      : { sent: false, reason: 'WhatsApp belum terhubung atau nomor ditolak. Cek koneksi WhatsApp di Pengaturan.' };
  }

  private definitionOr404(key: string) {
    const def = getDefinition(key);
    if (!def) throw new BadRequestException(`Notifikasi '${key}' tidak dikenal.`);
    return def;
  }
}
