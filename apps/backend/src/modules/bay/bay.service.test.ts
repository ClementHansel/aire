import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { BayStatus, MachineStatus } from '@aire/shared';
import { BayService } from './bay.service';

describe('BayService', () => {
  let service: BayService;
  let mockPool: { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> };
  let mockRealtimeGateway: { emitBayStatusChanged: ReturnType<typeof vi.fn> };

  const mockBayRow = {
    id: 'bay-001',
    outlet_id: 'outlet-001',
    name: 'Bay 1',
    status: 'available',
    current_order_id: null,
    sensor_data: {
      vehiclePresent: false,
      waterFlow: 0,
      foamLevel: 80,
      machineStatus: 'idle',
    },
    updated_at: new Date('2024-06-15T10:00:00.000Z'),
  };

  const mockOccupiedBayRow = {
    ...mockBayRow,
    id: 'bay-002',
    name: 'Bay 2',
    status: 'occupied',
    current_order_id: 'order-001',
    sensor_data: {
      vehiclePresent: true,
      waterFlow: 5.2,
      foamLevel: 60,
      machineStatus: 'running',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = {
      query: vi.fn(),
      connect: vi.fn(),
    };
    mockRealtimeGateway = {
      emitBayStatusChanged: vi.fn(),
    };
    service = new BayService(mockPool as any, mockRealtimeGateway as any);
  });

  describe('listBays', () => {
    it('should return all bays for a tenant', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [mockBayRow, mockOccupiedBayRow],
      });

      const result = await service.listBays({ tenantId: 'tenant-001' });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('bay-001');
      expect(result[0].status).toBe(BayStatus.Available);
      expect(result[1].id).toBe('bay-002');
      expect(result[1].status).toBe(BayStatus.Occupied);

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('tenant_id = $1');
      expect(params[0]).toBe('tenant-001');
    });

    it('should filter by outletId', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockBayRow] });

      await service.listBays({ tenantId: 'tenant-001', outletId: 'outlet-001' });

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('outlet_id = $2');
      expect(params[1]).toBe('outlet-001');
    });

    it('should filter by status', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockBayRow] });

      await service.listBays({ tenantId: 'tenant-001', status: BayStatus.Available });

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('status = $2');
      expect(params[1]).toBe('available');
    });

    it('should combine outletId and status filters', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.listBays({
        tenantId: 'tenant-001',
        outletId: 'outlet-001',
        status: BayStatus.Occupied,
      });

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('tenant_id = $1');
      expect(sql).toContain('outlet_id = $2');
      expect(sql).toContain('status = $3');
      expect(params).toEqual(['tenant-001', 'outlet-001', 'occupied']);
    });

    it('should throw BadRequestException for invalid status filter', async () => {
      await expect(
        service.listBays({ tenantId: 'tenant-001', status: 'invalid' as any }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should map sensor data correctly', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockOccupiedBayRow] });

      const result = await service.listBays({ tenantId: 'tenant-001' });

      expect(result[0].sensorData).toEqual({
        vehiclePresent: true,
        waterFlow: 5.2,
        foamLevel: 60,
        machineStatus: MachineStatus.Running,
      });
    });

    it('should default sensor data when empty', async () => {
      const rowWithEmptySensor = { ...mockBayRow, sensor_data: {} };
      mockPool.query.mockResolvedValueOnce({ rows: [rowWithEmptySensor] });

      const result = await service.listBays({ tenantId: 'tenant-001' });

      expect(result[0].sensorData).toEqual({
        vehiclePresent: false,
        waterFlow: 0,
        foamLevel: 0,
        machineStatus: MachineStatus.Idle,
      });
    });

    it('should order results by name', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.listBays({ tenantId: 'tenant-001' });

      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('ORDER BY name');
    });
  });

  describe('getBay', () => {
    it('should return a bay by id and tenant', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockBayRow] });

      const result = await service.getBay('tenant-001', 'bay-001');

      expect(result.id).toBe('bay-001');
      expect(result.outletId).toBe('outlet-001');
      expect(result.name).toBe('Bay 1');
      expect(result.status).toBe(BayStatus.Available);
      expect(result.lastUpdated).toBe('2024-06-15T10:00:00.000Z');

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('id = $1 AND tenant_id = $2');
      expect(params).toEqual(['bay-001', 'tenant-001']);
    });

    it('should throw NotFoundException when bay not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.getBay('tenant-001', 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should not include currentOrderId when null', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockBayRow] });

      const result = await service.getBay('tenant-001', 'bay-001');

      expect(result.currentOrderId).toBeUndefined();
    });

    it('should include currentOrderId when present', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockOccupiedBayRow] });

      const result = await service.getBay('tenant-001', 'bay-002');

      expect(result.currentOrderId).toBe('order-001');
    });
  });

  describe('assignOrder', () => {
    it('should assign an order to an available bay', async () => {
      // getBay query
      mockPool.query.mockResolvedValueOnce({ rows: [mockBayRow] });
      // update query
      mockPool.query.mockResolvedValueOnce({ rows: [{ outlet_id: 'outlet-001' }] });

      await service.assignOrder('tenant-001', 'bay-001', 'order-123');

      const [sql, params] = mockPool.query.mock.calls[1];
      expect(sql).toContain('UPDATE bays');
      expect(sql).toContain('current_order_id = $1');
      expect(sql).toContain('status = $2');
      expect(params[0]).toBe('order-123');
      expect(params[1]).toBe(BayStatus.Occupied);
      expect(params[2]).toBe('bay-001');
      expect(params[3]).toBe('tenant-001');
    });

    it('should emit real-time bay status change after assignment', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockBayRow] });
      mockPool.query.mockResolvedValueOnce({ rows: [{ outlet_id: 'outlet-001' }] });

      await service.assignOrder('tenant-001', 'bay-001', 'order-123');

      expect(mockRealtimeGateway.emitBayStatusChanged).toHaveBeenCalledWith('outlet-001', {
        bayId: 'bay-001',
        status: BayStatus.Occupied,
        sensorData: { vehiclePresent: true },
      });
    });

    it('should throw BadRequestException when bay is not available', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockOccupiedBayRow] });

      await expect(
        service.assignOrder('tenant-001', 'bay-002', 'order-123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when bay does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.assignOrder('tenant-001', 'nonexistent', 'order-123'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for bay in maintenance', async () => {
      const maintenanceBay = { ...mockBayRow, status: 'maintenance' };
      mockPool.query.mockResolvedValueOnce({ rows: [maintenanceBay] });

      await expect(
        service.assignOrder('tenant-001', 'bay-001', 'order-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateStatus', () => {
    it('should update bay status', async () => {
      // getBay query
      mockPool.query.mockResolvedValueOnce({ rows: [mockOccupiedBayRow] });
      // update query
      const updatedRow = { ...mockOccupiedBayRow, status: 'available', current_order_id: null };
      mockPool.query.mockResolvedValueOnce({ rows: [updatedRow] });

      const result = await service.updateStatus('tenant-001', 'bay-002', {
        status: BayStatus.Available,
      });

      expect(result.status).toBe(BayStatus.Available);

      const [sql] = mockPool.query.mock.calls[1];
      expect(sql).toContain('UPDATE bays');
      expect(sql).toContain('status = $1');
    });

    it('should clear current_order_id when set to available', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockOccupiedBayRow] });
      const updatedRow = { ...mockOccupiedBayRow, status: 'available', current_order_id: null };
      mockPool.query.mockResolvedValueOnce({ rows: [updatedRow] });

      await service.updateStatus('tenant-001', 'bay-002', {
        status: BayStatus.Available,
      });

      const [sql] = mockPool.query.mock.calls[1];
      expect(sql).toContain('current_order_id = NULL');
    });

    it('should merge sensor data when provided', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockBayRow] });
      const updatedRow = {
        ...mockBayRow,
        status: 'occupied',
        sensor_data: { vehiclePresent: true, waterFlow: 3.5, foamLevel: 80, machineStatus: 'running' },
      };
      mockPool.query.mockResolvedValueOnce({ rows: [updatedRow] });

      await service.updateStatus('tenant-001', 'bay-001', {
        status: BayStatus.Occupied,
        sensorData: { vehiclePresent: true, waterFlow: 3.5 },
      });

      const [sql, params] = mockPool.query.mock.calls[1];
      expect(sql).toContain('sensor_data = sensor_data ||');
      expect(params[1]).toBe(JSON.stringify({ vehiclePresent: true, waterFlow: 3.5 }));
    });

    it('should emit real-time update after status change', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockBayRow] });
      const updatedRow = { ...mockBayRow, status: 'maintenance' };
      mockPool.query.mockResolvedValueOnce({ rows: [updatedRow] });

      await service.updateStatus('tenant-001', 'bay-001', {
        status: BayStatus.Maintenance,
      });

      expect(mockRealtimeGateway.emitBayStatusChanged).toHaveBeenCalledWith(
        'outlet-001',
        expect.objectContaining({
          bayId: 'bay-001',
          status: BayStatus.Maintenance,
        }),
      );
    });

    it('should throw BadRequestException for invalid status', async () => {
      await expect(
        service.updateStatus('tenant-001', 'bay-001', {
          status: 'invalid' as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when bay does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.updateStatus('tenant-001', 'nonexistent', {
          status: BayStatus.Maintenance,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('openGate', () => {
    it('should send gate open command for available bay', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockBayRow] });

      await service.openGate('tenant-001', 'bay-001');

      expect(mockRealtimeGateway.emitBayStatusChanged).toHaveBeenCalledWith(
        'outlet-001',
        {
          bayId: 'bay-001',
          status: BayStatus.Available,
          sensorData: { gateCommand: 'open' },
        },
      );
    });

    it('should send gate open command for occupied bay', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockOccupiedBayRow] });

      await service.openGate('tenant-001', 'bay-002');

      expect(mockRealtimeGateway.emitBayStatusChanged).toHaveBeenCalledWith(
        'outlet-001',
        {
          bayId: 'bay-002',
          status: BayStatus.Occupied,
          sensorData: { gateCommand: 'open' },
        },
      );
    });

    it('should throw BadRequestException when bay is in maintenance', async () => {
      const maintenanceBay = { ...mockBayRow, status: 'maintenance' };
      mockPool.query.mockResolvedValueOnce({ rows: [maintenanceBay] });

      await expect(
        service.openGate('tenant-001', 'bay-001'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when bay does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.openGate('tenant-001', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
