import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditService, AuditLogEntry, AuditQueryParams } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;
  let mockPool: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = { query: vi.fn() };
    service = new AuditService(mockPool as any);
  });

  describe('log', () => {
    it('should insert an audit log entry with all fields', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const entry: AuditLogEntry = {
        tenantId: 'tenant-001',
        outletId: 'outlet-001',
        userId: 'user-001',
        operation: 'void',
        entityType: 'order',
        entityId: 'order-123',
        beforeValue: { status: 'paid' },
        afterValue: { status: 'cancelled' },
        metadata: { reason: 'Duplicate order' },
        ipAddress: '192.168.1.100',
      };

      await service.log(entry);

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO audit_logs');
      expect(params[0]).toBe('tenant-001');
      expect(params[1]).toBe('outlet-001');
      expect(params[2]).toBe('user-001');
      expect(params[3]).toBe('void');
      expect(params[4]).toBe('order');
      expect(params[5]).toBe('order-123');
      expect(params[6]).toBe(JSON.stringify({ status: 'paid' }));
      expect(params[7]).toBe(JSON.stringify({ status: 'cancelled' }));
      expect(params[8]).toBe(JSON.stringify({ reason: 'Duplicate order' }));
      expect(params[9]).toBe('192.168.1.100');
    });

    it('should handle optional fields with null defaults', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const entry: AuditLogEntry = {
        tenantId: 'tenant-001',
        userId: 'user-001',
        operation: 'login',
        entityType: 'user',
      };

      await service.log(entry);

      const [, params] = mockPool.query.mock.calls[0];
      expect(params[1]).toBeNull(); // outletId
      expect(params[5]).toBeNull(); // entityId
      expect(params[6]).toBeNull(); // beforeValue
      expect(params[7]).toBeNull(); // afterValue
      expect(params[8]).toBe('{}'); // metadata defaults to empty object
      expect(params[9]).toBeNull(); // ipAddress
    });

    it('should serialize beforeValue and afterValue as JSON', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const entry: AuditLogEntry = {
        tenantId: 'tenant-001',
        userId: 'user-001',
        operation: 'plate_updated',
        entityType: 'membership_plate',
        entityId: 'plate-001',
        beforeValue: { plate: 'B 1234 ABC', brand: 'Toyota' },
        afterValue: { plate: 'D 5555 EFG', brand: 'Mazda' },
      };

      await service.log(entry);

      const [, params] = mockPool.query.mock.calls[0];
      expect(JSON.parse(params[6])).toEqual({ plate: 'B 1234 ABC', brand: 'Toyota' });
      expect(JSON.parse(params[7])).toEqual({ plate: 'D 5555 EFG', brand: 'Mazda' });
    });

    it('should handle metadata as JSON string', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const entry: AuditLogEntry = {
        tenantId: 'tenant-001',
        userId: 'user-001',
        operation: 'pin_usage',
        entityType: 'order',
        entityId: 'order-456',
        metadata: { pinUsed: true, approvedBy: 'admin-001' },
      };

      await service.log(entry);

      const [, params] = mockPool.query.mock.calls[0];
      expect(JSON.parse(params[8])).toEqual({ pinUsed: true, approvedBy: 'admin-001' });
    });
  });

  describe('listLogs', () => {
    const mockAuditRows = [
      {
        id: 'log-001',
        tenant_id: 'tenant-001',
        outlet_id: 'outlet-001',
        user_id: 'user-001',
        operation: 'void',
        entity_type: 'order',
        entity_id: 'order-123',
        before_value: { status: 'paid' },
        after_value: { status: 'cancelled' },
        metadata: { reason: 'Duplicate' },
        ip_address: '192.168.1.100',
        created_at: new Date('2024-06-15T10:30:00.000Z'),
      },
      {
        id: 'log-002',
        tenant_id: 'tenant-001',
        outlet_id: null,
        user_id: 'user-002',
        operation: 'login',
        entity_type: 'user',
        entity_id: 'user-002',
        before_value: null,
        after_value: null,
        metadata: {},
        ip_address: '10.0.0.1',
        created_at: new Date('2024-06-15T09:00:00.000Z'),
      },
    ];

    it('should return paginated audit logs scoped to tenant', async () => {
      // Count query
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '2' }] });
      // Data query
      mockPool.query.mockResolvedValueOnce({ rows: mockAuditRows });

      const params: AuditQueryParams = {
        tenantId: 'tenant-001',
      };

      const result = await service.listLogs(params);

      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(50);
      expect(result.totalPages).toBe(1);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].id).toBe('log-001');
      expect(result.data[0].tenantId).toBe('tenant-001');
      expect(result.data[0].operation).toBe('void');
      expect(result.data[0].createdAt).toBe('2024-06-15T10:30:00.000Z');
    });

    it('should enforce tenant_id filter in queries', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.listLogs({ tenantId: 'tenant-001' });

      // Both queries should include tenant_id = $1
      const countCall = mockPool.query.mock.calls[0];
      expect(countCall[0]).toContain('tenant_id = $1');
      expect(countCall[1][0]).toBe('tenant-001');

      const dataCall = mockPool.query.mock.calls[1];
      expect(dataCall[0]).toContain('tenant_id = $1');
      expect(dataCall[1][0]).toBe('tenant-001');
    });

    it('should filter by operation when provided', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockAuditRows[0]] });

      await service.listLogs({ tenantId: 'tenant-001', operation: 'void' });

      const countCall = mockPool.query.mock.calls[0];
      expect(countCall[0]).toContain('operation = $2');
      expect(countCall[1][1]).toBe('void');
    });

    it('should filter by entityType when provided', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockAuditRows[0]] });

      await service.listLogs({ tenantId: 'tenant-001', entityType: 'order' });

      const countCall = mockPool.query.mock.calls[0];
      expect(countCall[0]).toContain('entity_type = $2');
      expect(countCall[1][1]).toBe('order');
    });

    it('should filter by date range when dateFrom and dateTo are provided', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockAuditRows[0]] });

      await service.listLogs({
        tenantId: 'tenant-001',
        dateFrom: '2024-06-01T00:00:00.000Z',
        dateTo: '2024-06-30T23:59:59.999Z',
      });

      const countCall = mockPool.query.mock.calls[0];
      expect(countCall[0]).toContain('created_at >= $2');
      expect(countCall[0]).toContain('created_at <= $3');
      expect(countCall[1][1]).toBe('2024-06-01T00:00:00.000Z');
      expect(countCall[1][2]).toBe('2024-06-30T23:59:59.999Z');
    });

    it('should filter by outletId when provided', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockAuditRows[0]] });

      await service.listLogs({ tenantId: 'tenant-001', outletId: 'outlet-001' });

      const countCall = mockPool.query.mock.calls[0];
      expect(countCall[0]).toContain('outlet_id = $2');
      expect(countCall[1][1]).toBe('outlet-001');
    });

    it('should paginate results correctly', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '25' }] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.listLogs({
        tenantId: 'tenant-001',
        page: 2,
        pageSize: 10,
      });

      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(10);
      expect(result.total).toBe(25);
      expect(result.totalPages).toBe(3);

      // Verify LIMIT and OFFSET
      const dataCall = mockPool.query.mock.calls[1];
      const dataParams = dataCall[1];
      // pageSize = 10, offset = (2-1)*10 = 10
      expect(dataParams[dataParams.length - 2]).toBe(10); // LIMIT
      expect(dataParams[dataParams.length - 1]).toBe(10); // OFFSET
    });

    it('should cap pageSize at 100', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '200' }] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.listLogs({
        tenantId: 'tenant-001',
        pageSize: 500,
      });

      expect(result.pageSize).toBe(100);

      const dataCall = mockPool.query.mock.calls[1];
      const dataParams = dataCall[1];
      expect(dataParams[dataParams.length - 2]).toBe(100); // LIMIT capped at 100
    });

    it('should default to page 1 and pageSize 50', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '5' }] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.listLogs({ tenantId: 'tenant-001' });

      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(50);
    });

    it('should combine multiple filters', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockAuditRows[0]] });

      await service.listLogs({
        tenantId: 'tenant-001',
        outletId: 'outlet-001',
        operation: 'void',
        entityType: 'order',
        dateFrom: '2024-06-01',
        dateTo: '2024-06-30',
      });

      const countCall = mockPool.query.mock.calls[0];
      expect(countCall[0]).toContain('tenant_id = $1');
      expect(countCall[0]).toContain('outlet_id = $2');
      expect(countCall[0]).toContain('operation = $3');
      expect(countCall[0]).toContain('entity_type = $4');
      expect(countCall[0]).toContain('created_at >= $5');
      expect(countCall[0]).toContain('created_at <= $6');
      expect(countCall[1]).toEqual([
        'tenant-001',
        'outlet-001',
        'void',
        'order',
        '2024-06-01',
        '2024-06-30',
      ]);
    });

    it('should order results by created_at DESC', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.listLogs({ tenantId: 'tenant-001' });

      const dataCall = mockPool.query.mock.calls[1];
      expect(dataCall[0]).toContain('ORDER BY created_at DESC');
    });

    it('should map database rows to AuditLogRecord format', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockAuditRows[0]] });

      const result = await service.listLogs({ tenantId: 'tenant-001' });

      const record = result.data[0];
      expect(record.id).toBe('log-001');
      expect(record.tenantId).toBe('tenant-001');
      expect(record.outletId).toBe('outlet-001');
      expect(record.userId).toBe('user-001');
      expect(record.operation).toBe('void');
      expect(record.entityType).toBe('order');
      expect(record.entityId).toBe('order-123');
      expect(record.beforeValue).toEqual({ status: 'paid' });
      expect(record.afterValue).toEqual({ status: 'cancelled' });
      expect(record.metadata).toEqual({ reason: 'Duplicate' });
      expect(record.ipAddress).toBe('192.168.1.100');
      expect(record.createdAt).toBe('2024-06-15T10:30:00.000Z');
    });

    it('should handle null outlet_id and null entity_id in records', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockAuditRows[1]] });

      const result = await service.listLogs({ tenantId: 'tenant-001' });

      const record = result.data[0];
      expect(record.outletId).toBeNull();
      expect(record.beforeValue).toBeNull();
      expect(record.afterValue).toBeNull();
    });
  });
});
