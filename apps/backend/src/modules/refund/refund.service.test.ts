import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JWTPayload, ERR_VOID_PIN_REQUIRED, ERR_VOID_PIN_INVALID } from '@aire/shared';
import { RefundService } from './refund.service';
import { NotificationService } from '../notification/notification.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

const cashier: JWTPayload = {
  sub: 'operator-1', tenant_id: 'tenant-1', outlet_id: 'outlet-1', role: 'cashier', iat: 1, exp: 2,
};
const owner: JWTPayload = {
  sub: 'owner-1', tenant_id: 'tenant-1', outlet_id: 'outlet-1', role: 'tenant_owner', iat: 1, exp: 2,
};

describe('RefundService — one-time refund PIN (requestRefundPin)', () => {
  function setup(opts: { escalationNumber?: string | null; ownerEmail?: string | null; whatsappOk?: boolean; withWhatsapp?: boolean } = {}) {
    const poolSql: string[] = [];
    const sentEmails: { to: string; subject: string; body: string }[] = [];
    const sentWhatsapp: { to: string; text: string }[] = [];
    const pool = {
      query: vi.fn().mockImplementation((sql: string) => {
        const s = String(sql);
        poolSql.push(s);
        if (s.includes('FROM orders WHERE id')) {
          return Promise.resolve({ rows: [{ id: 'order-1', outlet_id: 'outlet-1', order_number: 'ORD-1' }] });
        }
        if (s.includes('FROM agent_configs')) {
          return Promise.resolve({ rows: opts.escalationNumber === undefined ? [] : [{ escalation_number: opts.escalationNumber }] });
        }
        if (s.includes("role = 'tenant_owner'")) {
          return Promise.resolve({ rows: opts.ownerEmail === null ? [] : [{ email: opts.ownerEmail ?? 'owner@tenant.com' }] });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
      connect: vi.fn(),
    };
    const notification = {
      sendEmail: vi.fn().mockImplementation(async (msg: any) => { sentEmails.push(msg); return { success: true, messageId: 'msg-1' }; }),
    };
    const whatsapp = opts.withWhatsapp === false ? undefined : {
      sendText: vi.fn().mockImplementation(async (_tenantId: string, to: string, text: string) => {
        sentWhatsapp.push({ to, text });
        return opts.whatsappOk ?? true;
      }),
    };
    const svc = new RefundService(
      pool as never,
      undefined,
      notification as unknown as NotificationService,
      whatsapp as unknown as WhatsappService,
    );
    return { svc, pool, poolSql, sentEmails, sentWhatsapp, notification };
  }

  it('prefers WhatsApp when an escalation number is configured', async () => {
    const { svc, poolSql, sentEmails, sentWhatsapp } = setup({ escalationNumber: '628111222333', whatsappOk: true });

    const res = await svc.requestRefundPin('order-1', cashier);

    expect(res).toEqual({ sent: true, expiresInMinutes: 10, channel: 'whatsapp' });
    expect(poolSql.some((s) => s.includes('UPDATE void_pin_requests SET consumed_at = NOW()') && s.includes('consumed_at IS NULL'))).toBe(true);
    expect(poolSql.some((s) => s.includes('INSERT INTO void_pin_requests'))).toBe(true);
    expect(sentWhatsapp).toHaveLength(1);
    expect(sentWhatsapp[0]!.to).toBe('628111222333');
    expect(sentWhatsapp[0]!.text).toMatch(/\d{6}/);
    expect(sentEmails).toHaveLength(0);
  });

  it('falls back to email when no escalation number is configured', async () => {
    const { svc, sentEmails, sentWhatsapp } = setup({ escalationNumber: undefined });

    const res = await svc.requestRefundPin('order-1', cashier);

    expect(res.channel).toBe('email');
    expect(sentWhatsapp).toHaveLength(0);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.to).toBe('owner@tenant.com');
    expect(sentEmails[0]!.body).toMatch(/\d{6}/);
    expect(sentEmails[0]!.subject).toContain('ORD-1');
  });

  it('falls back to email when the WhatsApp send fails', async () => {
    const { svc, sentEmails, sentWhatsapp } = setup({ escalationNumber: '628111222333', whatsappOk: false });

    const res = await svc.requestRefundPin('order-1', cashier);

    expect(res.channel).toBe('email');
    expect(sentWhatsapp).toHaveLength(1); // attempted
    expect(sentEmails).toHaveLength(1); // then fell back
  });

  it('throws when the order is not found (tenant-scoped lookup)', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn() };
    const svc = new RefundService(pool as never);

    await expect(svc.requestRefundPin('missing-order', cashier)).rejects.toThrow(BadRequestException);
  });

  it('throws when neither a WhatsApp escalation number nor an owner email is available', async () => {
    const { svc } = setup({ escalationNumber: undefined, ownerEmail: null, withWhatsapp: false });

    await expect(svc.requestRefundPin('order-1', cashier)).rejects.toThrow(BadRequestException);
  });
});

describe('RefundService.createRefund — one-time PIN verification', () => {
  // An order paid well outside any free-void window (default 0 min).
  const orderRow = {
    id: 'order-1',
    status: 'paid',
    total: '100000.00',
    tax: '11000.00',
    order_number: 'ORD-1',
    outlet_id: 'outlet-1',
    created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    shift_status: 'open',
    outlet_settings: { free_void_window_minutes: 0 },
  };
  const refundDto = {
    orderId: 'order-1',
    reason: 'customer complaint',
    refundMethod: 'cash',
    items: [{ orderItemId: 'item-1', quantity: 1, amount: 50000 }],
  };

  // Builds a pool/client pair. `pinRow` simulates the latest live
  // void_pin_requests row for this order (null = none live).
  function setup(pinPlaintext: string | null, pinRow: { id: string } | null) {
    const clientSql: unknown[][] = [];
    const client = {
      query: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
        clientSql.push([String(sql), params]);
        if (String(sql).includes('INSERT INTO refunds')) return Promise.resolve({ rows: [{ id: 'refund-1' }] });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn().mockImplementation((sql: string) => {
        const s = String(sql);
        if (s.includes('FROM orders o')) return Promise.resolve({ rows: [orderRow] });
        if (s.includes('FROM void_pin_requests')) {
          if (!pinRow) return Promise.resolve({ rows: [] });
          return Promise.resolve({ rows: [{ id: pinRow.id, pin_hash: bcrypt.hashSync(pinPlaintext!, 10) }] });
        }
        if (s.includes('FROM order_items WHERE order_id')) {
          return Promise.resolve({ rows: [{ id: 'item-1', quantity: '1', subtotal: '50000' }] });
        }
        if (s.includes('FROM refund_items ri JOIN refunds r')) return Promise.resolve({ rows: [] });
        if (s.includes("status = 'open'")) return Promise.resolve({ rows: [{ id: 'shift-1' }] });
        if (s.includes('refund_number LIKE')) return Promise.resolve({ rows: [{ n: '0' }] });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
      connect: vi.fn().mockResolvedValue(client),
    };
    return { pool, client, clientSql };
  }

  it('owner bypasses the PIN requirement even past the free-void window', async () => {
    const { pool } = setup(null, null);
    const svc = new RefundService(pool as never);

    const res = await svc.createRefund('tenant-1', { ...refundDto }, owner);
    expect(res.id).toBe('refund-1');
  });

  it('cashier past the free window without a PIN is asked for one (requiresPin)', async () => {
    const { pool } = setup(null, null);
    const svc = new RefundService(pool as never);

    try {
      await svc.createRefund('tenant-1', { ...refundDto }, cashier);
      expect.fail('expected BadRequestException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect(e.getResponse()).toMatchObject({ code: ERR_VOID_PIN_REQUIRED, requiresPin: true });
    }
  });

  it('rejects an incorrect PIN', async () => {
    const { pool } = setup('123456', { id: 'pin-1' }); // live PIN is 123456
    const svc = new RefundService(pool as never);

    try {
      await svc.createRefund('tenant-1', { ...refundDto, adminPin: '000000' }, cashier);
      expect.fail('expected BadRequestException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect(e.getResponse()).toMatchObject({ code: ERR_VOID_PIN_INVALID, requiresPin: true });
    }
  });

  it('rejects a PIN when none is live (already consumed or expired) — single-use enforced', async () => {
    const { pool } = setup(null, null); // no live row: simulates a consumed/expired PIN

    const svc = new RefundService(pool as never);

    try {
      await svc.createRefund('tenant-1', { ...refundDto, adminPin: '123456' }, cashier);
      expect.fail('expected BadRequestException');
    } catch (e: any) {
      expect(e.getResponse()).toMatchObject({ code: ERR_VOID_PIN_INVALID, requiresPin: true });
    }
  });

  it('accepts a correct, live PIN and consumes it (single-use) in the same transaction', async () => {
    const { pool, client, clientSql } = setup('123456', { id: 'pin-1' });
    const svc = new RefundService(pool as never);

    const res = await svc.createRefund('tenant-1', { ...refundDto, adminPin: '123456' }, cashier);

    expect(res.id).toBe('refund-1');
    expect(clientSql.some(([s]) => String(s).includes('UPDATE void_pin_requests SET consumed_at = NOW() WHERE id = $1'))).toBe(true);
    expect(client.query).toHaveBeenCalledWith(
      'UPDATE void_pin_requests SET consumed_at = NOW() WHERE id = $1',
      ['pin-1'],
    );
  });
});
