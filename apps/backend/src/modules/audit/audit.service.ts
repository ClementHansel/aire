import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

/**
 * Represents a single audit log entry to be persisted.
 */
export interface AuditLogEntry {
  tenantId: string;
  outletId?: string;
  userId: string;
  operation: string;
  entityType: string;
  entityId?: string;
  beforeValue?: unknown;
  afterValue?: unknown;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

/**
 * Query parameters for listing/filtering audit logs.
 */
export interface AuditQueryParams {
  tenantId: string;
  outletId?: string;
  operation?: string;
  entityType?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

/**
 * A single audit log record returned from the database.
 */
export interface AuditLogRecord {
  id: string;
  tenantId: string;
  outletId: string | null;
  userId: string;
  operation: string;
  entityType: string;
  entityId: string | null;
  beforeValue: unknown;
  afterValue: unknown;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

/**
 * Paginated response wrapper for audit log queries.
 */
export interface PaginatedAuditResponse {
  data: AuditLogRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Security-relevant operations that must be logged.
 */
export const AUDITABLE_OPERATIONS = [
  'login',
  'login_failed',
  'role_change',
  'void',
  'plate_added',
  'plate_updated',
  'plate_removed',
  'plates_released',
  'config_change',
  'pin_usage',
  'membership_activated',
  'membership_cancelled',
  'voucher_redeemed',
] as const;

export type AuditableOperation = (typeof AUDITABLE_OPERATIONS)[number] | string;

@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * Creates a new audit log entry for a security-relevant operation.
   * Records: timestamp (auto), user_id, tenant_id, outlet_id, operation,
   * entity_type, entity_id, before/after values, metadata, and IP address.
   *
   * Requirement 40.1: Log all security-relevant operations.
   * Requirement 40.2: Record timestamp, user identity, tenant_id, outlet_id,
   *   operation type, affected entity, and before/after values.
   */
  async log(entry: AuditLogEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_logs (tenant_id, outlet_id, user_id, operation, entity_type, entity_id, before_value, after_value, metadata, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        entry.tenantId,
        entry.outletId ?? null,
        entry.userId,
        entry.operation,
        entry.entityType,
        entry.entityId ?? null,
        entry.beforeValue ? JSON.stringify(entry.beforeValue) : null,
        entry.afterValue ? JSON.stringify(entry.afterValue) : null,
        entry.metadata ? JSON.stringify(entry.metadata) : '{}',
        entry.ipAddress ?? null,
      ],
    );
  }

  /**
   * Queries audit logs with filtering and pagination, scoped to a tenant.
   * Supports filtering by operation, entityType, and date range.
   *
   * Requirement 40.4: Provide audit log viewing and filtering for Tenant_Owners
   *   scoped to their Tenant.
   */
  async listLogs(params: AuditQueryParams): Promise<PaginatedAuditResponse> {
    const page = params.page ?? 1;
    const pageSize = Math.min(params.pageSize ?? 50, 100);
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ['tenant_id = $1'];
    const values: unknown[] = [params.tenantId];
    let paramIndex = 2;

    if (params.outletId) {
      conditions.push(`outlet_id = $${paramIndex}`);
      values.push(params.outletId);
      paramIndex++;
    }

    if (params.operation) {
      conditions.push(`operation = $${paramIndex}`);
      values.push(params.operation);
      paramIndex++;
    }

    if (params.entityType) {
      conditions.push(`entity_type = $${paramIndex}`);
      values.push(params.entityType);
      paramIndex++;
    }

    if (params.dateFrom) {
      conditions.push(`created_at >= $${paramIndex}`);
      values.push(params.dateFrom);
      paramIndex++;
    }

    if (params.dateTo) {
      conditions.push(`created_at <= $${paramIndex}`);
      values.push(params.dateTo);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Count query
    const countResult = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM audit_logs WHERE ${whereClause}`,
      values,
    );
    const total = parseInt(countResult.rows[0]!.count, 10);

    // Data query with pagination
    const dataResult = await this.pool.query(
      `SELECT id, tenant_id, outlet_id, user_id, operation, entity_type, entity_id,
              before_value, after_value, metadata, ip_address, created_at
       FROM audit_logs
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...values, pageSize, offset],
    );

    const data: AuditLogRecord[] = dataResult.rows.map((row: any) => ({
      id: row.id,
      tenantId: row.tenant_id,
      outletId: row.outlet_id,
      userId: row.user_id,
      operation: row.operation,
      entityType: row.entity_type,
      entityId: row.entity_id,
      beforeValue: row.before_value,
      afterValue: row.after_value,
      metadata: row.metadata ?? {},
      ipAddress: row.ip_address,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    }));

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}
