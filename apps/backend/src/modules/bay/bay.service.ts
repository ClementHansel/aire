import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { BayStatusDTO, BayStatus, MachineStatus } from '@aire/shared';
import { DATABASE_POOL } from '../auth/database.provider';
import { RealtimeGateway } from '../realtime';

/**
 * Query parameters for listing bays.
 */
export interface BayListParams {
  tenantId: string;
  outletId?: string;
  status?: BayStatus;
}

/**
 * Update bay status request.
 */
export interface UpdateBayStatusParams {
  status: BayStatus;
  sensorData?: Partial<{
    vehiclePresent: boolean;
    waterFlow: number;
    foamLevel: number;
    machineStatus: MachineStatus;
  }>;
}

const VALID_STATUSES: string[] = Object.values(BayStatus);

@Injectable()
export class BayService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  /**
   * Lists bays for an outlet with optional status filtering.
   *
   * Requirements: 26.3
   */
  async listBays(params: BayListParams): Promise<BayStatusDTO[]> {
    const conditions: string[] = ['tenant_id = $1'];
    const values: unknown[] = [params.tenantId];
    let paramIndex = 2;

    if (params.outletId) {
      conditions.push(`outlet_id = $${paramIndex}`);
      values.push(params.outletId);
      paramIndex++;
    }

    if (params.status) {
      this.validateStatus(params.status);
      conditions.push(`status = $${paramIndex}`);
      values.push(params.status);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const result = await this.pool.query(
      `SELECT id, outlet_id, name, status, current_order_id, sensor_data, updated_at
       FROM bays
       WHERE ${whereClause}
       ORDER BY name`,
      values,
    );

    return result.rows.map((row: any) => this.mapRow(row));
  }

  /**
   * Gets a single bay with sensor data.
   *
   * Requirements: 26.3
   */
  async getBay(tenantId: string, bayId: string): Promise<BayStatusDTO> {
    const result = await this.pool.query(
      `SELECT id, outlet_id, name, status, current_order_id, sensor_data, updated_at
       FROM bays
       WHERE id = $1 AND tenant_id = $2`,
      [bayId, tenantId],
    );

    if (result.rows.length === 0) {
      throw new NotFoundException(`Bay with id ${bayId} not found`);
    }

    return this.mapRow(result.rows[0]);
  }

  /**
   * Assigns an order to a bay and sets status to occupied.
   *
   * Requirements: 26.4
   */
  async assignOrder(tenantId: string, bayId: string, orderId: string): Promise<void> {
    // Verify bay exists and is available
    const bay = await this.getBay(tenantId, bayId);

    if (bay.status !== BayStatus.Available) {
      throw new BadRequestException(
        `Bay "${bay.name}" is not available (current status: ${bay.status})`,
      );
    }

    const result = await this.pool.query(
      `UPDATE bays
       SET current_order_id = $1, status = $2, updated_at = NOW()
       WHERE id = $3 AND tenant_id = $4
       RETURNING outlet_id`,
      [orderId, BayStatus.Occupied, bayId, tenantId],
    );

    if (result.rows.length > 0) {
      this.realtimeGateway.emitBayStatusChanged(result.rows[0].outlet_id, {
        bayId,
        status: BayStatus.Occupied,
        sensorData: { vehiclePresent: true },
      });
    }
  }

  /**
   * Updates bay status and optionally sensor data.
   * Emits real-time status change event.
   *
   * Requirements: 26.3, 26.5
   */
  async updateStatus(
    tenantId: string,
    bayId: string,
    params: UpdateBayStatusParams,
  ): Promise<BayStatusDTO> {
    this.validateStatus(params.status);

    // Verify bay exists
    await this.getBay(tenantId, bayId);

    const setClauses: string[] = ['status = $1', 'updated_at = NOW()'];
    const values: unknown[] = [params.status];
    let paramIndex = 2;

    // If moving to available, clear current order
    if (params.status === BayStatus.Available) {
      setClauses.push('current_order_id = NULL');
    }

    // Merge sensor data if provided
    if (params.sensorData) {
      setClauses.push(`sensor_data = sensor_data || $${paramIndex}::jsonb`);
      values.push(JSON.stringify(params.sensorData));
      paramIndex++;
    }

    const result = await this.pool.query(
      `UPDATE bays
       SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
       RETURNING id, outlet_id, name, status, current_order_id, sensor_data, updated_at`,
      [...values, bayId, tenantId],
    );

    const updatedBay = this.mapRow(result.rows[0]);

    // Emit real-time update
    this.realtimeGateway.emitBayStatusChanged(updatedBay.outletId, {
      bayId,
      status: updatedBay.status,
      sensorData: updatedBay.sensorData as unknown as Record<string, unknown>,
    });

    return updatedBay;
  }

  /**
   * Sends a gate-open command for the bay.
   * In production this triggers an MQTT publish to the bay controller.
   * Here we update status and emit the event.
   *
   * Requirements: 26.5
   */
  async openGate(tenantId: string, bayId: string): Promise<void> {
    const bay = await this.getBay(tenantId, bayId);

    if (bay.status === BayStatus.Maintenance) {
      throw new BadRequestException(
        `Cannot open gate for bay "${bay.name}" — bay is in maintenance mode`,
      );
    }

    // In production, this would publish to MQTT:
    // topic: aire/{tenant_id}/{outlet_id}/bay/{bay_id}/command
    // payload: { command: 'gate_open', timestamp: Date.now() }

    // Emit gate command event for real-time notification
    this.realtimeGateway.emitBayStatusChanged(bay.outletId, {
      bayId,
      status: bay.status,
      sensorData: { gateCommand: 'open' },
    });
  }

  private validateStatus(status: string): void {
    if (!VALID_STATUSES.includes(status)) {
      throw new BadRequestException(
        `Invalid bay status: ${status}. Must be one of: ${VALID_STATUSES.join(', ')}`,
      );
    }
  }

  private mapRow(row: any): BayStatusDTO {
    const sensorData = row.sensor_data || {};
    return {
      id: row.id,
      outletId: row.outlet_id,
      name: row.name,
      status: row.status as BayStatus,
      currentOrderId: row.current_order_id ?? undefined,
      sensorData: {
        vehiclePresent: sensorData.vehiclePresent ?? false,
        waterFlow: sensorData.waterFlow ?? 0,
        foamLevel: sensorData.foamLevel ?? 0,
        machineStatus: sensorData.machineStatus ?? MachineStatus.Idle,
      },
      lastUpdated: row.updated_at
        ? new Date(row.updated_at).toISOString()
        : new Date().toISOString(),
    };
  }
}
