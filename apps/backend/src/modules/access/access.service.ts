import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import { DATABASE_POOL } from '../auth/database.provider';
import { EntitlementService } from '../entitlement';

/**
 * Catalog of assignable permission keys, grouped for the RBAC editor UI.
 * Dynamic roles store a subset of these keys.
 */
export const PERMISSION_CATALOG: { group: string; permissions: { key: string; label: string }[] }[] = [
  { group: 'Transactions', permissions: [
    { key: 'transactions.read', label: 'View transactions' },
    { key: 'transactions.write', label: 'Create/edit transactions' },
    { key: 'transactions.delete', label: 'Delete/void transactions' },
  ]},
  { group: 'Customers & Members', permissions: [
    { key: 'customers.read', label: 'View customers & members' },
    { key: 'customers.write', label: 'Manage customers & members' },
  ]},
  { group: 'Catalog', permissions: [
    { key: 'products.read', label: 'View products' },
    { key: 'products.write', label: 'Manage products/categories/brands' },
  ]},
  { group: 'Branches', permissions: [
    { key: 'branches.read', label: 'View branches' },
    { key: 'branches.write', label: 'Manage branches & payment methods' },
  ]},
  { group: 'Promotions & Vouchers', permissions: [
    { key: 'promotions.write', label: 'Manage promotions' },
    { key: 'vouchers.write', label: 'Manage/sell vouchers' },
  ]},
  { group: 'Reports', permissions: [
    { key: 'reports.read', label: 'View reports & analytics' },
    { key: 'reports.export', label: 'Export reports' },
  ]},
  { group: 'Finance & Accounting', permissions: [
    { key: 'finance.read', label: 'View finance, P&L, bookkeeping & settlement' },
    { key: 'finance.write', label: 'Record expenses, post journal entries, settle, provision & pricing' },
  ]},
  { group: 'HR & Payroll', permissions: [
    { key: 'hr.read', label: 'View employees, schedules & leave' },
    { key: 'hr.write', label: 'Manage employees, schedules, leave & attendance' },
    { key: 'payroll.read', label: 'View payroll & payslips' },
    { key: 'payroll.write', label: 'Run payroll, adjustments & loans' },
  ]},
  { group: 'AI', permissions: [
    { key: 'ai.read', label: 'View AI conversations' },
    { key: 'ai.write', label: 'Configure AI agent' },
  ]},
  { group: 'Administration', permissions: [
    { key: 'users.write', label: 'Manage users' },
    { key: 'roles.write', label: 'Manage roles & permissions (high privilege)' },
  ]},
];

export interface RoleRecord {
  id: string; tenantId: string; name: string; description: string | null;
  baseRole: string; permissions: string[]; isSystem: boolean;
}
export interface UserRecord {
  id: string; tenantId: string; name: string; email: string; role: string;
  customRoleId: string | null; isActive: boolean; outletIds: string[];
}

const BASE_ROLES = ['platform_super_admin', 'tenant_owner', 'outlet_admin', 'cashier'];

/**
 * Roles a tenant may assign to its own users. `platform_super_admin` is AIRIN
 * platform staff and is deliberately absent: the /api/users endpoints are
 * reachable by any tenant_owner, so accepting it there let a client mint
 * themselves a platform super-admin. Custom-role definitions still validate
 * against BASE_ROLES, which is inheritance metadata rather than a grant.
 */
const TENANT_ASSIGNABLE_ROLES = ['tenant_owner', 'outlet_admin', 'cashier'];

@Injectable()
export class AccessService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly entitlements: EntitlementService,
  ) {}

  getPermissionCatalog() {
    return PERMISSION_CATALOG;
  }

  // ── Roles ─────────────────────────────────────────────────────────────────
  async listRoles(tenantId: string): Promise<RoleRecord[]> {
    const res = await this.pool.query('SELECT * FROM roles WHERE tenant_id = $1 ORDER BY name', [tenantId]);
    return res.rows.map(this.mapRole);
  }

  async createRole(tenantId: string, dto: { name: string; description?: string; baseRole?: string; permissions?: string[] }): Promise<RoleRecord> {
    if (!dto.name?.trim()) throw new BadRequestException('name is required');
    const baseRole = dto.baseRole ?? 'cashier';
    if (!BASE_ROLES.includes(baseRole)) throw new BadRequestException('invalid baseRole');
    const res = await this.pool.query(
      `INSERT INTO roles (tenant_id, name, description, base_role, permissions)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [tenantId, dto.name.trim(), dto.description ?? null, baseRole, JSON.stringify(dto.permissions ?? [])],
    );
    return this.mapRole(res.rows[0]);
  }

  async updateRole(tenantId: string, id: string, patch: { name?: string; description?: string; baseRole?: string; permissions?: string[] }): Promise<RoleRecord> {
    const set: string[] = []; const v: unknown[] = []; let i = 1;
    if (patch.name !== undefined) { set.push(`name = $${i++}`); v.push(patch.name); }
    if (patch.description !== undefined) { set.push(`description = $${i++}`); v.push(patch.description); }
    if (patch.baseRole !== undefined) {
      if (!BASE_ROLES.includes(patch.baseRole)) throw new BadRequestException('invalid baseRole');
      set.push(`base_role = $${i++}`); v.push(patch.baseRole);
    }
    if (patch.permissions !== undefined) { set.push(`permissions = $${i++}`); v.push(JSON.stringify(patch.permissions)); }
    if (set.length === 0) throw new BadRequestException('No fields to update');
    set.push('updated_at = NOW()'); v.push(id, tenantId);
    const res = await this.pool.query(
      `UPDATE roles SET ${set.join(', ')} WHERE id = $${i} AND tenant_id = $${i + 1} AND is_system = false RETURNING *`, v,
    );
    if (res.rows.length === 0) throw new NotFoundException('Role not found or is a system role');
    return this.mapRole(res.rows[0]);
  }

  async removeRole(tenantId: string, id: string): Promise<void> {
    const res = await this.pool.query('DELETE FROM roles WHERE id = $1 AND tenant_id = $2 AND is_system = false', [id, tenantId]);
    if (res.rowCount === 0) throw new NotFoundException('Role not found or is a system role');
  }

  // ── Users ─────────────────────────────────────────────────────────────────
  /**
   * Users belonging to a tenant, for that tenant's own Users & Roles screen.
   *
   * AIRIN platform staff are deliberately excluded: a platform_super_admin row
   * carrying a tenant_id (created when AIRIN staff are provisioned against a
   * tenant) is our operator, not the client's employee. Leaking it into the
   * client's user list exposed AIRIN's internal accounts to the tenant owner and
   * offered Edit/Delete on them (AIRIN-105).
   *
   * @param includePlatformAdmins internal use only — never true on a request
   *   path. Set by post-write re-reads so a just-written row can still be found.
   */
  async listUsers(tenantId: string, includePlatformAdmins = false): Promise<UserRecord[]> {
    const res = await this.pool.query(
      `SELECT u.id, u.tenant_id, u.name, u.email, u.role, u.custom_role_id, u.is_active,
              COALESCE(array_agg(uo.outlet_id) FILTER (WHERE uo.outlet_id IS NOT NULL), '{}') AS outlet_ids
       FROM users u
       LEFT JOIN user_outlets uo ON uo.user_id = u.id
       WHERE u.tenant_id = $1
         AND ($2::boolean OR u.role <> 'platform_super_admin')
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
      [tenantId, includePlatformAdmins],
    );
    return res.rows.map(this.mapUser);
  }

  async createUser(tenantId: string, dto: { name: string; email: string; password: string; role?: string; customRoleId?: string | null; outletIds?: string[] }): Promise<UserRecord> {
    if (!dto.name?.trim() || !dto.email?.trim() || !dto.password) throw new BadRequestException('name, email, password required');
    const role = dto.role ?? 'cashier';
    if (!TENANT_ASSIGNABLE_ROLES.includes(role)) throw new BadRequestException('invalid role');
    // Plan entitlement: block if the tenant is at its staff-login (seat) cap.
    await this.entitlements.assertWithin(tenantId, 'users');
    const hash = await bcrypt.hash(dto.password, 10);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const primaryOutlet = dto.outletIds?.[0] ?? null;
      const ins = await client.query(
        `INSERT INTO users (tenant_id, outlet_id, email, password_hash, name, role, custom_role_id, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING id`,
        [tenantId, primaryOutlet, dto.email.trim().toLowerCase(), hash, dto.name.trim(), role, dto.customRoleId ?? null],
      );
      const userId = ins.rows[0].id;
      for (const oid of dto.outletIds ?? []) {
        await client.query('INSERT INTO user_outlets (user_id, outlet_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, oid]);
      }
      await client.query('COMMIT');
      // includePlatformAdmins: this is a post-write re-read of a row we just
      // created, which may itself be a platform admin — the list filter would
      // otherwise hide it and the non-null assertion below would lie.
      return (await this.listUsers(tenantId, true)).find((u) => u.id === userId)!;
    } catch (e: any) {
      await client.query('ROLLBACK');
      if (e?.code === '23505') throw new BadRequestException('Email already in use');
      throw e;
    } finally {
      client.release();
    }
  }

  async updateUser(tenantId: string, id: string, patch: { name?: string; role?: string; customRoleId?: string | null; isActive?: boolean; outletIds?: string[]; password?: string }): Promise<UserRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const set: string[] = []; const v: unknown[] = []; let i = 1;
      if (patch.name !== undefined) { set.push(`name = $${i++}`); v.push(patch.name); }
      if (patch.role !== undefined) {
        if (!TENANT_ASSIGNABLE_ROLES.includes(patch.role)) throw new BadRequestException('invalid role');
        set.push(`role = $${i++}`); v.push(patch.role);
      }
      if (patch.customRoleId !== undefined) { set.push(`custom_role_id = $${i++}`); v.push(patch.customRoleId); }
      if (patch.isActive !== undefined) { set.push(`is_active = $${i++}`); v.push(patch.isActive); }
      if (patch.password) { set.push(`password_hash = $${i++}`); v.push(await bcrypt.hash(patch.password, 10)); }
      if (patch.outletIds !== undefined) { set.push(`outlet_id = $${i++}`); v.push(patch.outletIds[0] ?? null); }
      if (set.length > 0) {
        set.push('updated_at = NOW()'); v.push(id, tenantId);
        // Platform staff are invisible to the tenant's list, so they must also be
        // untouchable through it — otherwise a tenant owner could reset the
        // password of, or deactivate, an AIRIN operator by guessing their id.
        const res = await client.query(
          `UPDATE users SET ${set.join(', ')} WHERE id = $${i} AND tenant_id = $${i + 1} AND role <> 'platform_super_admin' RETURNING id`,
          v,
        );
        if (res.rows.length === 0) throw new NotFoundException('User not found');
      }
      if (patch.outletIds !== undefined) {
        await client.query('DELETE FROM user_outlets WHERE user_id = $1', [id]);
        for (const oid of patch.outletIds) {
          await client.query('INSERT INTO user_outlets (user_id, outlet_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, oid]);
        }
      }
      await client.query('COMMIT');
      // includePlatformAdmins: post-write re-read — see createUser above.
      return (await this.listUsers(tenantId, true)).find((u) => u.id === id)!;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async deactivateUser(tenantId: string, id: string): Promise<void> {
    // See updateUser: AIRIN platform staff are out of the tenant's reach.
    const res = await this.pool.query(
      `UPDATE users SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND role <> 'platform_super_admin'`,
      [id, tenantId],
    );
    if (res.rowCount === 0) throw new NotFoundException('User not found');
  }

  private mapRole = (r: any): RoleRecord => ({
    id: r.id, tenantId: r.tenant_id, name: r.name, description: r.description ?? null,
    baseRole: r.base_role, permissions: Array.isArray(r.permissions) ? r.permissions : [], isSystem: r.is_system,
  });
  private mapUser = (r: any): UserRecord => ({
    id: r.id, tenantId: r.tenant_id, name: r.name, email: r.email, role: r.role,
    customRoleId: r.custom_role_id ?? null, isActive: r.is_active, outletIds: r.outlet_ids ?? [],
  });
}
