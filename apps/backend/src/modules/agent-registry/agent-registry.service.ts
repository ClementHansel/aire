import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../auth/database.provider';

export type AgentRole = 'personal_assistant' | 'customer_service' | 'sales' | 'supervisor';
const ROLES: AgentRole[] = ['personal_assistant', 'customer_service', 'sales', 'supervisor'];

export interface AgentRecord {
  id: string;
  name: string;
  role: AgentRole;
  description: string | null;
  prompt: string | null;
  isActive: boolean;
  position: number;
}

export interface UpsertAgentDto {
  name?: string;
  role?: AgentRole;
  description?: string | null;
  prompt?: string | null;
  isActive?: boolean;
  position?: number;
}

@Injectable()
export class AgentRegistryService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  private map(r: any): AgentRecord {
    return {
      id: r.id,
      name: r.name,
      role: r.role,
      description: r.description,
      prompt: r.prompt,
      isActive: r.is_active,
      position: r.position,
    };
  }

  async list(tenantId: string): Promise<AgentRecord[]> {
    const res = await this.pool.query(
      `SELECT id, name, role, description, prompt, is_active, position
       FROM agents WHERE tenant_id = $1 ORDER BY position, created_at`,
      [tenantId],
    );
    return res.rows.map((r) => this.map(r));
  }

  async create(tenantId: string, dto: UpsertAgentDto): Promise<AgentRecord> {
    if (!dto.name?.trim()) throw new BadRequestException('name is required');
    if (dto.role && !ROLES.includes(dto.role)) throw new BadRequestException('Invalid role');
    const res = await this.pool.query(
      `INSERT INTO agents (tenant_id, name, role, description, prompt, is_active, position)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, (SELECT COALESCE(MAX(position),0)+1 FROM agents WHERE tenant_id=$1)))
       RETURNING id, name, role, description, prompt, is_active, position`,
      [tenantId, dto.name.trim(), dto.role ?? 'personal_assistant', dto.description ?? null, dto.prompt ?? null, dto.isActive ?? true, dto.position ?? null],
    );
    return this.map(res.rows[0]);
  }

  async update(tenantId: string, id: string, dto: UpsertAgentDto): Promise<AgentRecord> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    const push = (c: string, v: unknown) => { sets.push(`${c} = $${i++}`); vals.push(v); };
    if (dto.name !== undefined) push('name', dto.name);
    if (dto.role !== undefined) {
      if (!ROLES.includes(dto.role)) throw new BadRequestException('Invalid role');
      push('role', dto.role);
    }
    if (dto.description !== undefined) push('description', dto.description);
    if (dto.prompt !== undefined) push('prompt', dto.prompt);
    if (dto.isActive !== undefined) push('is_active', dto.isActive);
    if (dto.position !== undefined) push('position', dto.position);
    if (sets.length === 0) {
      const cur = await this.pool.query(`SELECT id, name, role, description, prompt, is_active, position FROM agents WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
      if (cur.rows.length === 0) throw new NotFoundException('Agent not found');
      return this.map(cur.rows[0]);
    }
    vals.push(id, tenantId);
    const res = await this.pool.query(
      `UPDATE agents SET ${sets.join(', ')} WHERE id = $${i++} AND tenant_id = $${i}
       RETURNING id, name, role, description, prompt, is_active, position`,
      vals,
    );
    if (res.rows.length === 0) throw new NotFoundException('Agent not found');
    return this.map(res.rows[0]);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const res = await this.pool.query(`DELETE FROM agents WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (res.rowCount === 0) throw new NotFoundException('Agent not found');
  }
}
