import { Injectable, Inject } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';
import { StorageService, StoredObject } from '../storage';

export type CardIdType = 'number' | 'number_barcode' | 'number_qr';
export interface CardElement {
  field: 'name' | 'number' | 'code' | 'validUntil';
  x: number; y: number; w: number; h: number;
  fontSize: number; color: string; align: 'left' | 'center' | 'right';
}
export type CardSide = 'front' | 'back';
export interface CardTemplate {
  idType: CardIdType;
  width: number;
  height: number;
  /** Versioned public URL of the front background image in object storage, or null. */
  backgroundImage: string | null;
  elements: CardElement[];
  /** Versioned public URL of the back background image, or null. */
  backBackgroundImage: string | null;
  /** Fields placed on the back of the card (may be empty). */
  backElements: CardElement[];
}

/** Object-storage key for a tenant's card background (per side). */
function cardBgKey(tenantId: string, side: CardSide): string {
  return side === 'back' ? `tenants/${tenantId}/card-bg-back` : `tenants/${tenantId}/card-bg`;
}

/**
 * Membership card template — layout + field placement stored in
 * tenants.settings.membershipCard (JSONB). The background image binary lives in
 * object storage (MinIO/S3); the template's `backgroundImage` holds a versioned
 * public streaming URL, never a base64 blob.
 */
@Injectable()
export class MembershipCardService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly storage: StorageService,
  ) {}

  private defaultTemplate(): CardTemplate {
    return {
      idType: 'number_qr',
      width: 800,
      height: 500,
      backgroundImage: null,
      elements: [
        { field: 'name', x: 40, y: 360, w: 420, h: 40, fontSize: 30, color: '#111111', align: 'left' },
        { field: 'number', x: 40, y: 410, w: 420, h: 32, fontSize: 24, color: '#111111', align: 'left' },
        { field: 'validUntil', x: 40, y: 452, w: 240, h: 24, fontSize: 16, color: '#333333', align: 'left' },
        { field: 'code', x: 560, y: 330, w: 200, h: 140, fontSize: 0, color: '#000000', align: 'center' },
      ],
      backBackgroundImage: null,
      backElements: [],
    };
  }

  /** Fill in fields missing from templates saved before the front/back split. */
  private normalize(card: CardTemplate): CardTemplate {
    return {
      ...card,
      backBackgroundImage: card.backBackgroundImage ?? null,
      backElements: Array.isArray(card.backElements) ? card.backElements : [],
    };
  }

  async get(tenantId: string): Promise<CardTemplate> {
    const r = await this.pool.query<{ card: CardTemplate | null }>(
      `SELECT settings->'membershipCard' AS card FROM tenants WHERE id = $1`,
      [tenantId],
    );
    const card = r.rows[0]?.card;
    return card && Array.isArray(card.elements) ? this.normalize(card) : this.defaultTemplate();
  }

  async set(tenantId: string, template: CardTemplate): Promise<CardTemplate> {
    // Never persist an inline data-URL background (would reintroduce blobs in
    // Postgres). A data: value means an old client — preserve the stored URL.
    let next = this.normalize(template);
    if (typeof next.backgroundImage === 'string' && next.backgroundImage.startsWith('data:')) {
      const existing = await this.get(tenantId);
      next = { ...next, backgroundImage: existing.backgroundImage };
    }
    if (typeof next.backBackgroundImage === 'string' && next.backBackgroundImage.startsWith('data:')) {
      const existing = await this.get(tenantId);
      next = { ...next, backBackgroundImage: existing.backBackgroundImage };
    }
    // Merge into settings.membershipCard, preserving other settings keys (branding etc.).
    await this.pool.query(
      `UPDATE tenants
       SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{membershipCard}', $2::jsonb, true),
           updated_at = NOW()
       WHERE id = $1`,
      [tenantId, JSON.stringify(next)],
    );
    return this.get(tenantId);
  }

  /** Upload the card background (front or back) to object storage; returns the updated template. */
  async setBackground(tenantId: string, buffer: Buffer, contentType: string, side: CardSide = 'front'): Promise<CardTemplate> {
    await this.storage.put(cardBgKey(tenantId, side), buffer, contentType);
    const version = createHash('sha256').update(buffer).digest('hex').slice(0, 12);
    const url = `/api/public/card-template/background?tenantId=${encodeURIComponent(tenantId)}&side=${side}&v=${version}`;
    const current = await this.get(tenantId);
    return this.set(tenantId, side === 'back' ? { ...current, backBackgroundImage: url } : { ...current, backgroundImage: url });
  }

  async removeBackground(tenantId: string, side: CardSide = 'front'): Promise<CardTemplate> {
    await this.storage.delete(cardBgKey(tenantId, side)).catch(() => undefined);
    const current = await this.get(tenantId);
    return this.set(tenantId, side === 'back' ? { ...current, backBackgroundImage: null } : { ...current, backgroundImage: null });
  }

  /** Stream the stored card background for a tenant/side (or null if none). */
  async getBackground(tenantId: string, side: CardSide = 'front'): Promise<StoredObject | null> {
    return this.storage.get(cardBgKey(tenantId, side));
  }
}
