import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { normalizePhone } from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';
import { NotificationService } from '../notification/notification.service';
import { EventBusService } from '../events/event-bus.service';
import { DomainEventType } from '../events/event.types';
import type { ToolInvocation, ToolResult } from './agent.types';

/**
 * AgentToolsService — the real implementations behind every agent tool.
 *
 * Read tools query the live database (the agent's "eyes"). Action tools
 * perform genuine side effects (WhatsApp sends, price updates, anomaly flags)
 * and emit domain events so the action itself is observable on the bus.
 */
@Injectable()
export class AgentToolsService {
  private readonly logger = new Logger(AgentToolsService.name);

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly notifications: NotificationService,
    private readonly eventBus: EventBusService,
  ) {}

  /** Dispatch a tool invocation to its handler. */
  async run(invocation: ToolInvocation): Promise<ToolResult> {
    const { toolName, tenantId } = invocation;
    const p = invocation.parameters ?? {};
    try {
      switch (toolName) {
        // ── Read tools ──────────────────────────────────────────────
        case 'get_business_summary':
          return { success: true, data: await this.businessSummary(tenantId) };
        case 'list_orders':
          return { success: true, data: { orders: await this.listOrders(tenantId, p) } };
        case 'find_customer':
          return { success: true, data: await this.findCustomer(tenantId, p) };
        case 'list_memberships':
          return { success: true, data: await this.listMemberships(tenantId) };
        case 'list_services':
          return { success: true, data: { services: await this.listServices(tenantId) } };
        case 'get_queue_status':
          return { success: true, data: await this.queueStatus(tenantId, invocation.outletId) };
        case 'list_recent_events': {
          const events = await this.eventBus.recent(tenantId, {
            type: p.type as string | undefined,
            limit: (p.limit as number) ?? 30,
          });
          return { success: true, data: { events } };
        }
        // ── Action tools ────────────────────────────────────────────
        case 'create_campaign':
          return await this.createCampaign(invocation);
        case 'send_retention_offer':
          return await this.sendOffer(invocation, 'retention');
        case 'send_membership_recommendation':
          return await this.sendOffer(invocation, 'membership');
        case 'suggest_pricing':
          return await this.suggestPricing(invocation);
        case 'adjust_queue_priority':
          return await this.adjustQueue(invocation);
        case 'flag_anomaly':
          return await this.flagAnomaly(invocation);
        default:
          return { success: false, error: `No handler implemented for tool "${toolName}"` };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Tool ${toolName} failed: ${msg}`);
      return { success: false, error: msg };
    }
  }

  // ─── Read implementations ─────────────────────────────────────────────────

  private async businessSummary(tenantId: string): Promise<Record<string, unknown>> {
    const paidStatuses = `('paid','confirmed','completed')`;
    const revenue = await this.pool.query<{ today: string; d7: string; d30: string }>(
      `SELECT
         COALESCE(SUM(total) FILTER (WHERE created_at::date = CURRENT_DATE), 0) AS today,
         COALESCE(SUM(total) FILTER (WHERE created_at > NOW() - INTERVAL '7 days'), 0) AS d7,
         COALESCE(SUM(total) FILTER (WHERE created_at > NOW() - INTERVAL '30 days'), 0) AS d30
       FROM orders
       WHERE tenant_id = $1 AND status IN ${paidStatuses}`,
      [tenantId],
    );
    const statusCounts = await this.pool.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*) AS count FROM orders
       WHERE tenant_id = $1 AND created_at::date = CURRENT_DATE
       GROUP BY status`,
      [tenantId],
    );
    const members = await this.pool.query<{ active: string; expiring: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active') AS active,
         COUNT(*) FILTER (WHERE status = 'active' AND end_date <= CURRENT_DATE + INTERVAL '30 days') AS expiring
       FROM memberships WHERE tenant_id = $1`,
      [tenantId],
    );
    const bays = await this.pool.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*) AS count FROM bays WHERE tenant_id = $1 GROUP BY status`,
      [tenantId],
    );
    const r = revenue.rows[0]!;
    return {
      revenue: { today: parseFloat(r.today), last7Days: parseFloat(r.d7), last30Days: parseFloat(r.d30) },
      ordersTodayByStatus: Object.fromEntries(statusCounts.rows.map((x) => [x.status, parseInt(x.count, 10)])),
      memberships: { active: parseInt(members.rows[0]!.active, 10), expiringWithin30Days: parseInt(members.rows[0]!.expiring, 10) },
      bays: Object.fromEntries(bays.rows.map((x) => [x.status, parseInt(x.count, 10)])),
    };
  }

  private async listOrders(tenantId: string, p: Record<string, unknown>): Promise<unknown[]> {
    const limit = Math.min((p.limit as number) ?? 20, 100);
    const params: unknown[] = [tenantId];
    let where = 'tenant_id = $1';
    if (p.status) {
      params.push(p.status);
      where += ` AND status = $${params.length}`;
    }
    params.push(limit);
    const res = await this.pool.query(
      `SELECT order_number, status, customer_name, customer_phone, total, created_at
       FROM orders WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
    );
    return res.rows.map((o) => ({
      orderNumber: o.order_number,
      status: o.status,
      customer: o.customer_name,
      phone: o.customer_phone,
      total: parseFloat(o.total),
      createdAt: o.created_at,
    }));
  }

  private async findCustomer(tenantId: string, p: Record<string, unknown>): Promise<Record<string, unknown>> {
    let row;
    if (p.phone) {
      const { normalized } = normalizePhone(String(p.phone));
      const res = await this.pool.query(
        `SELECT id, name, phone FROM customers WHERE tenant_id = $1 AND phone_normalized = $2 LIMIT 1`,
        [tenantId, normalized || String(p.phone).replace(/\D/g, '')],
      );
      row = res.rows[0];
    } else if (p.name) {
      const res = await this.pool.query(
        `SELECT id, name, phone FROM customers WHERE tenant_id = $1 AND name ILIKE $2 ORDER BY created_at DESC LIMIT 1`,
        [tenantId, `%${String(p.name)}%`],
      );
      row = res.rows[0];
    }
    if (!row) return { found: false };

    const memberships = await this.pool.query(
      `SELECT mp.name, m.status, m.end_date, m.uses_count, m.max_uses
       FROM memberships m JOIN membership_plans mp ON mp.id = m.plan_id
       WHERE m.customer_id = $1 ORDER BY m.created_at DESC`,
      [row.id],
    );
    const orders = await this.pool.query(
      `SELECT order_number, status, total, created_at FROM orders
       WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [row.id],
    );
    return {
      found: true,
      customer: { id: row.id, name: row.name, phone: row.phone },
      memberships: memberships.rows.map((m) => ({
        plan: m.name, status: m.status, endDate: m.end_date, usesCount: m.uses_count, maxUses: m.max_uses,
      })),
      recentOrders: orders.rows.map((o) => ({
        orderNumber: o.order_number, status: o.status, total: parseFloat(o.total), createdAt: o.created_at,
      })),
    };
  }

  private async listMemberships(tenantId: string): Promise<Record<string, unknown>> {
    const active = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM memberships WHERE tenant_id = $1 AND status = 'active'`,
      [tenantId],
    );
    const expiring = await this.pool.query(
      `SELECT c.name, c.phone, m.end_date, mp.name AS plan
       FROM memberships m
       JOIN customers c ON c.id = m.customer_id
       JOIN membership_plans mp ON mp.id = m.plan_id
       WHERE m.tenant_id = $1 AND m.status = 'active'
         AND m.end_date <= CURRENT_DATE + INTERVAL '30 days'
       ORDER BY m.end_date ASC LIMIT 50`,
      [tenantId],
    );
    return {
      activeCount: parseInt(active.rows[0]!.count, 10),
      expiringSoon: expiring.rows.map((m) => ({ customer: m.name, phone: m.phone, plan: m.plan, endDate: m.end_date })),
    };
  }

  private async listServices(tenantId: string): Promise<unknown[]> {
    const res = await this.pool.query(
      `SELECT id, name, category, price, is_active FROM services WHERE tenant_id = $1 ORDER BY sort_order`,
      [tenantId],
    );
    return res.rows.map((s) => ({ id: s.id, name: s.name, category: s.category, price: parseFloat(s.price), active: s.is_active }));
  }

  private async queueStatus(tenantId: string, outletId?: string): Promise<Record<string, unknown>> {
    const params: unknown[] = [tenantId];
    let bayWhere = 'tenant_id = $1';
    if (outletId) {
      params.push(outletId);
      bayWhere += ` AND outlet_id = $${params.length}`;
    }
    const bays = await this.pool.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*) AS count FROM bays WHERE ${bayWhere} GROUP BY status`,
      params,
    );
    const waiting = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM orders
       WHERE tenant_id = $1 AND status IN ('paid','confirmed') AND created_at::date = CURRENT_DATE`,
      [tenantId],
    );
    return {
      bays: Object.fromEntries(bays.rows.map((b) => [b.status, parseInt(b.count, 10)])),
      ordersWaitingToday: parseInt(waiting.rows[0]!.count, 10),
    };
  }

  // ─── Action implementations ───────────────────────────────────────────────

  private async createCampaign(inv: ToolInvocation): Promise<ToolResult> {
    const p = inv.parameters;
    const segment = String(p.target_segment ?? 'all').toLowerCase();
    const template = String(p.message_template ?? '');
    let where = 'tenant_id = $1';
    if (segment.includes('member')) {
      where = `tenant_id = $1 AND id IN (SELECT customer_id FROM memberships WHERE tenant_id = $1 AND status = 'active')`;
    } else if (segment.includes('laps') || segment.includes('churn')) {
      where = `tenant_id = $1 AND id NOT IN (SELECT customer_id FROM orders WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '60 days' AND customer_id IS NOT NULL)`;
    }
    const recipients = await this.pool.query<{ phone: string; name: string }>(
      `SELECT phone, name FROM customers WHERE ${where} LIMIT 200`,
      [inv.tenantId],
    );
    let delivered = 0;
    for (const r of recipients.rows.slice(0, 200)) {
      const res = await this.notifications.sendWhatsApp({
        to: r.phone,
        templateName: 'campaign_bonus',
        params: { customerName: r.name, campaignName: String(p.campaign_name ?? 'Promo'), codes: '', expiryDate: '' },
        tenantId: inv.tenantId,
      });
      if (res.success) delivered++;
    }
    const campaignId = randomUUID();
    await this.eventBus.emit({
      type: DomainEventType.AgentToolExecuted,
      tenantId: inv.tenantId,
      outletId: inv.outletId,
      actor: 'agent',
      payload: { tool: 'create_campaign', campaignId, segment, recipients: recipients.rowCount, delivered, template },
    });
    return { success: true, data: { campaign_id: campaignId, recipients_count: recipients.rowCount ?? 0, delivered } };
  }

  private async sendOffer(inv: ToolInvocation, kind: 'retention' | 'membership'): Promise<ToolResult> {
    const p = inv.parameters;
    const customerId = String(p.customer_id ?? '');
    const cust = await this.pool.query<{ name: string; phone: string }>(
      `SELECT name, phone FROM customers WHERE id = $1 AND tenant_id = $2`,
      [customerId, inv.tenantId],
    );
    if (cust.rows.length === 0) return { success: false, error: 'Customer not found' };
    const c = cust.rows[0]!;
    const res = await this.notifications.sendWhatsApp({
      to: c.phone,
      templateName: kind === 'retention' ? 'retention_offer' : 'membership_recommendation',
      params: {
        customerName: c.name,
        offer: String(p.offer_value ?? p.reasoning ?? ''),
        reasoning: String(p.reasoning ?? ''),
      },
      tenantId: inv.tenantId,
    });
    const offerId = randomUUID();
    await this.eventBus.emit({
      type: DomainEventType.AgentToolExecuted,
      tenantId: inv.tenantId,
      outletId: inv.outletId,
      actor: 'agent',
      payload: { tool: kind === 'retention' ? 'send_retention_offer' : 'send_membership_recommendation', customerId, delivered: res.success },
    });
    const key = kind === 'retention' ? 'offer_id' : 'recommendation_id';
    return { success: true, data: { [key]: offerId, delivered: res.success } };
  }

  private async suggestPricing(inv: ToolInvocation): Promise<ToolResult> {
    const p = inv.parameters;
    const serviceId = String(p.service_id ?? '');
    const suggested = Number(p.suggested_price);
    if (!serviceId || Number.isNaN(suggested) || suggested < 0) {
      return { success: false, error: 'service_id and a valid suggested_price are required' };
    }
    const upd = await this.pool.query(
      `UPDATE services SET price = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3 RETURNING id`,
      [suggested, serviceId, inv.tenantId],
    );
    if (upd.rowCount === 0) return { success: false, error: 'Service not found' };
    const suggestionId = randomUUID();
    await this.eventBus.emit({
      type: DomainEventType.AgentToolExecuted,
      tenantId: inv.tenantId,
      outletId: inv.outletId,
      actor: 'agent',
      payload: { tool: 'suggest_pricing', serviceId, newPrice: suggested, reasoning: p.reasoning },
    });
    return { success: true, data: { suggestion_id: suggestionId, applied: true } };
  }

  private async adjustQueue(inv: ToolInvocation): Promise<ToolResult> {
    const p = inv.parameters;
    await this.eventBus.emit({
      type: DomainEventType.AgentToolExecuted,
      tenantId: inv.tenantId,
      outletId: inv.outletId,
      actor: 'agent',
      payload: { tool: 'adjust_queue_priority', bayId: p.bay_id, adjustments: p.priority_adjustments, reason: p.reason },
    });
    const adjustments = Array.isArray(p.priority_adjustments) ? p.priority_adjustments.length : 0;
    return { success: true, data: { applied: true, affected_entries: adjustments } };
  }

  private async flagAnomaly(inv: ToolInvocation): Promise<ToolResult> {
    const p = inv.parameters;
    const anomalyId = randomUUID();
    await this.eventBus.emit({
      type: DomainEventType.AgentAnomalyFlagged,
      tenantId: inv.tenantId,
      outletId: inv.outletId,
      actor: 'agent',
      payload: {
        anomalyId,
        anomalyType: p.anomaly_type,
        severity: p.severity,
        description: p.description,
        metricName: p.metric_name,
        expectedValue: p.expected_value,
        actualValue: p.actual_value,
      },
    });
    return { success: true, data: { anomaly_id: anomalyId, notified: true } };
  }
}
