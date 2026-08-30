import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ServiceCategory } from '@aire/shared';
import { ServiceService } from './service.service';

describe('ServiceService', () => {
  let service: ServiceService;
  let mockPool: { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> };
  // AIRIN-176: the allowed business units come from the tenant's own table now,
  // so the service takes a validator. These tests are about services, not unit
  // membership — a stub that accepts keeps them focused.
  let mockBusinessUnits: { assertValid: ReturnType<typeof vi.fn> };

  const mockServiceRow = {
    id: 'svc-001',
    tenant_id: 'tenant-001',
    outlet_id: null,
    name: 'Super Wash',
    category: 'car_wash',
    business_unit: 'AIRE',
    price: '50000',
    is_active: true,
    is_main_service: true,
    sort_order: 1,
    category_id: null,
    brand_id: null,
    outlet_ids: null,
    barcode: null,
    dynamic_discount_enabled: false,
    dynamic_discount_kind: null,
    max_discount: null,
    created_at: new Date('2024-06-15T10:00:00.000Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = {
      query: vi.fn(),
      connect: vi.fn(),
    };
    mockBusinessUnits = { assertValid: vi.fn().mockResolvedValue(undefined) };
    service = new ServiceService(mockPool as any, mockBusinessUnits as any);
  });

  describe('create', () => {
    it('should create a service and return the mapped DTO', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockServiceRow] });

      const result = await service.create('tenant-001', {
        name: 'Super Wash',
        category: ServiceCategory.CarWash,
        price: 50000,
      });

      expect(result).toEqual({
        id: 'svc-001',
        tenantId: 'tenant-001',
        outletId: null,
        name: 'Super Wash',
        category: 'car_wash',
        businessUnit: 'AIRE',
        price: 50000,
        isActive: true,
        isMainService: true,
        sortOrder: 1,
        categoryId: null,
        brandId: null,
        outletIds: null,
        barcode: null,
        dynamicDiscountEnabled: false,
        dynamicDiscountKind: null,
        maxDiscount: null,
      });

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO services');
      expect(params[0]).toBe('tenant-001');
      expect(params[1]).toBeNull(); // outlet_id
      expect(params[2]).toBe('Super Wash');
      expect(params[3]).toBe('car_wash');
      expect(params[4]).toBe('AIRE'); // business_unit (defaults to AIRE)
      expect(params[5]).toBe(50000);
      expect(params[6]).toBe(true); // is_active
      expect(params[7]).toBe(true); // is_main_service (car_wash default)
      expect(params[8]).toBe(0); // sort_order
      expect(params[13]).toBe(false); // dynamic_discount_enabled defaults false
      expect(params[14]).toBeNull(); // dynamic_discount_kind
      expect(params[15]).toBeNull(); // max_discount
    });

    it('should default is_main_service to true for car_wash category', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockServiceRow] });

      await service.create('tenant-001', {
        name: 'Basic Wash',
        category: ServiceCategory.CarWash,
        price: 30000,
      });

      const [, params] = mockPool.query.mock.calls[0];
      expect(params[7]).toBe(true); // is_main_service defaults to true
    });

    it('should default is_main_service to false for product category', async () => {
      const productRow = { ...mockServiceRow, category: 'product', is_main_service: false };
      // Product create reads the barcode feature config first (feature off → cfg null).
      mockPool.query.mockResolvedValueOnce({ rows: [{ cfg: null }] });
      mockPool.query.mockResolvedValueOnce({ rows: [productRow] });

      await service.create('tenant-001', {
        name: 'Air Freshener',
        category: ServiceCategory.Product,
        price: 15000,
      });

      const insertCall = mockPool.query.mock.calls.find((c: unknown[]) => String(c[0]).includes('INSERT INTO services'))!;
      expect(insertCall[1][7]).toBe(false); // is_main_service defaults to false for product
    });

    it('should default is_main_service to false for add_on category', async () => {
      const addonRow = { ...mockServiceRow, category: 'add_on', is_main_service: false };
      mockPool.query.mockResolvedValueOnce({ rows: [addonRow] });

      await service.create('tenant-001', {
        name: 'Waxing',
        category: ServiceCategory.AddOn,
        price: 25000,
      });

      const [, params] = mockPool.query.mock.calls[0];
      expect(params[7]).toBe(false); // is_main_service defaults to false for add_on
    });

    it('should allow explicit is_main_service override', async () => {
      const row = { ...mockServiceRow, is_main_service: false };
      mockPool.query.mockResolvedValueOnce({ rows: [row] });

      await service.create('tenant-001', {
        name: 'Special Wash',
        category: ServiceCategory.CarWash,
        price: 100000,
        isMainService: false,
      });

      const [, params] = mockPool.query.mock.calls[0];
      expect(params[7]).toBe(false); // explicit override
    });

    it('should set outlet_id when provided', async () => {
      const row = { ...mockServiceRow, outlet_id: 'outlet-001' };
      // Product create reads the barcode feature config first (feature off → cfg null).
      mockPool.query.mockResolvedValueOnce({ rows: [{ cfg: null }] });
      mockPool.query.mockResolvedValueOnce({ rows: [row] });

      await service.create('tenant-001', {
        name: 'Local Product',
        category: ServiceCategory.Product,
        price: 20000,
        outletId: 'outlet-001',
      });

      const insertCall = mockPool.query.mock.calls.find((c: unknown[]) => String(c[0]).includes('INSERT INTO services'))!;
      expect(insertCall[1][1]).toBe('outlet-001');
    });

    it('should throw BadRequestException for invalid category', async () => {
      await expect(
        service.create('tenant-001', {
          name: 'Invalid',
          category: 'invalid_category' as any,
          price: 10000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create with dynamic discount fields when coherent', async () => {
      const row = {
        ...mockServiceRow,
        dynamic_discount_enabled: true,
        dynamic_discount_kind: 'percentage',
        max_discount: '15',
      };
      mockPool.query.mockResolvedValueOnce({ rows: [row] });

      const result = await service.create('tenant-001', {
        name: 'Discountable Wash',
        category: ServiceCategory.CarWash,
        price: 50000,
        dynamicDiscountEnabled: true,
        dynamicDiscountKind: 'percentage',
        maxDiscount: 15,
      });

      expect(result.dynamicDiscountEnabled).toBe(true);
      expect(result.dynamicDiscountKind).toBe('percentage');
      expect(result.maxDiscount).toBe(15);

      const [, params] = mockPool.query.mock.calls[0];
      expect(params[13]).toBe(true);
      expect(params[14]).toBe('percentage');
      expect(params[15]).toBe(15);
    });
  });

  describe('dynamic discount validation', () => {
    it('should reject dynamicDiscountEnabled=true without a kind', async () => {
      await expect(
        service.create('tenant-001', {
          name: 'Bad Wash',
          category: ServiceCategory.CarWash,
          price: 50000,
          dynamicDiscountEnabled: true,
          maxDiscount: 10,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should reject dynamicDiscountEnabled=true without a maxDiscount', async () => {
      await expect(
        service.create('tenant-001', {
          name: 'Bad Wash',
          category: ServiceCategory.CarWash,
          price: 50000,
          dynamicDiscountEnabled: true,
          dynamicDiscountKind: 'fixed',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject a non-positive maxDiscount', async () => {
      await expect(
        service.create('tenant-001', {
          name: 'Bad Wash',
          category: ServiceCategory.CarWash,
          price: 50000,
          dynamicDiscountEnabled: true,
          dynamicDiscountKind: 'fixed',
          maxDiscount: 0,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.create('tenant-001', {
          name: 'Bad Wash',
          category: ServiceCategory.CarWash,
          price: 50000,
          dynamicDiscountEnabled: true,
          dynamicDiscountKind: 'fixed',
          maxDiscount: -5,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject maxDiscount > 100 when kind is percentage', async () => {
      await expect(
        service.create('tenant-001', {
          name: 'Bad Wash',
          category: ServiceCategory.CarWash,
          price: 50000,
          dynamicDiscountEnabled: true,
          dynamicDiscountKind: 'percentage',
          maxDiscount: 150,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow maxDiscount > 100 when kind is fixed (Rupiah)', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockServiceRow, dynamic_discount_enabled: true, dynamic_discount_kind: 'fixed', max_discount: '25000' }],
      });

      await expect(
        service.create('tenant-001', {
          name: 'Fixed Discount Wash',
          category: ServiceCategory.CarWash,
          price: 50000,
          dynamicDiscountEnabled: true,
          dynamicDiscountKind: 'fixed',
          maxDiscount: 25000,
        }),
      ).resolves.toBeTruthy();
    });

    it('should reject the same violations on update', async () => {
      await expect(
        service.update('tenant-001', 'svc-001', {
          dynamicDiscountEnabled: true,
        }),
      ).rejects.toThrow(BadRequestException);
      // Validation runs before findOne, so no query should have fired.
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should allow update with a coherent dynamic discount payload', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockServiceRow] }); // findOne
      mockPool.query.mockResolvedValueOnce({
        rows: [{ ...mockServiceRow, dynamic_discount_enabled: true, dynamic_discount_kind: 'fixed', max_discount: '10000' }],
      });

      const result = await service.update('tenant-001', 'svc-001', {
        dynamicDiscountEnabled: true,
        dynamicDiscountKind: 'fixed',
        maxDiscount: 10000,
      });

      expect(result.dynamicDiscountEnabled).toBe(true);
      expect(result.maxDiscount).toBe(10000);

      const [sql, params] = mockPool.query.mock.calls[1];
      expect(sql).toContain('dynamic_discount_enabled = $1');
      expect(sql).toContain('dynamic_discount_kind = $2');
      expect(sql).toContain('max_discount = $3');
      expect(params[0]).toBe(true);
      expect(params[1]).toBe('fixed');
      expect(params[2]).toBe(10000);
    });
  });

  describe('findAll', () => {
    it('should return all services for a tenant', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [mockServiceRow, { ...mockServiceRow, id: 'svc-002', name: 'Product A', category: 'product' }],
      });

      const result = await service.findAll({ tenantId: 'tenant-001' });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('svc-001');

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('tenant_id = $1');
      expect(params[0]).toBe('tenant-001');
    });

    it('should filter by category', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockServiceRow] });

      await service.findAll({ tenantId: 'tenant-001', category: ServiceCategory.CarWash });

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('category = $2');
      expect(params[1]).toBe('car_wash');
    });

    it('should filter by outletId including services with null outlet_id', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockServiceRow] });

      await service.findAll({ tenantId: 'tenant-001', outletId: 'outlet-001' });

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('outlet_id = $2 OR');
      expect(sql).toContain('$2 = ANY(outlet_ids)');
      expect(params[1]).toBe('outlet-001');
    });

    it('should filter by active status', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockServiceRow] });

      await service.findAll({ tenantId: 'tenant-001', active: true });

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('is_active = $2');
      expect(params[1]).toBe(true);
    });

    it('should combine multiple filters', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.findAll({
        tenantId: 'tenant-001',
        category: ServiceCategory.CarWash,
        outletId: 'outlet-001',
        active: true,
      });

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('tenant_id = $1');
      expect(sql).toContain('category = $2');
      expect(sql).toContain('$3 = ANY(outlet_ids)');
      expect(sql).toContain('is_active = $4');
      expect(params).toEqual(['tenant-001', 'car_wash', 'outlet-001', true]);
    });

    it('should order results by category, sort_order, name', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.findAll({ tenantId: 'tenant-001' });

      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('ORDER BY category, sort_order, name');
    });
  });

  describe('findOne', () => {
    it('should return a service by id and tenant', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockServiceRow] });

      const result = await service.findOne('tenant-001', 'svc-001');

      expect(result.id).toBe('svc-001');
      expect(result.tenantId).toBe('tenant-001');

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('id = $1 AND tenant_id = $2');
      expect(params).toEqual(['svc-001', 'tenant-001']);
    });

    it('should throw NotFoundException when service not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.findOne('tenant-001', 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update service fields', async () => {
      // findOne query
      mockPool.query.mockResolvedValueOnce({ rows: [mockServiceRow] });
      // update query
      const updatedRow = { ...mockServiceRow, name: 'Premium Wash', price: '75000' };
      mockPool.query.mockResolvedValueOnce({ rows: [updatedRow] });

      const result = await service.update('tenant-001', 'svc-001', {
        name: 'Premium Wash',
        price: 75000,
      });

      expect(result.name).toBe('Premium Wash');
      expect(result.price).toBe(75000);

      const [sql, params] = mockPool.query.mock.calls[1];
      expect(sql).toContain('UPDATE services');
      expect(sql).toContain('name = $1');
      expect(sql).toContain('price = $2');
      expect(params[0]).toBe('Premium Wash');
      expect(params[1]).toBe(75000);
    });

    it('should throw NotFoundException when updating nonexistent service', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.update('tenant-001', 'nonexistent', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for invalid category', async () => {
      await expect(
        service.update('tenant-001', 'svc-001', { category: 'invalid' as any }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return existing service if no fields to update', async () => {
      // First call: findOne verification in update
      mockPool.query.mockResolvedValueOnce({ rows: [mockServiceRow] });
      // Second call: findOne return when no fields to update
      mockPool.query.mockResolvedValueOnce({ rows: [mockServiceRow] });

      const result = await service.update('tenant-001', 'svc-001', {});

      expect(result.id).toBe('svc-001');
      // Two findOne queries (verify + return), no update query
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it('should update outlet_id', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockServiceRow] });
      const updatedRow = { ...mockServiceRow, outlet_id: 'outlet-002' };
      mockPool.query.mockResolvedValueOnce({ rows: [updatedRow] });

      await service.update('tenant-001', 'svc-001', { outletId: 'outlet-002' });

      const [sql, params] = mockPool.query.mock.calls[1];
      expect(sql).toContain('outlet_id = $1');
      expect(params[0]).toBe('outlet-002');
    });
  });

  describe('remove', () => {
    it('should soft-delete a service by setting is_active to false', async () => {
      // findOne query
      mockPool.query.mockResolvedValueOnce({ rows: [mockServiceRow] });
      // update query
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.remove('tenant-001', 'svc-001');

      const [sql, params] = mockPool.query.mock.calls[1];
      expect(sql).toContain('UPDATE services SET is_active = false');
      expect(params).toEqual(['svc-001', 'tenant-001']);
    });

    it('should throw NotFoundException when removing nonexistent service', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.remove('tenant-001', 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reorder', () => {
    it('should batch update sort_order within a transaction', async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
        release: vi.fn(),
      };
      mockPool.connect.mockResolvedValueOnce(mockClient);

      await service.reorder('tenant-001', [
        { id: 'svc-001', sortOrder: 0 },
        { id: 'svc-002', sortOrder: 1 },
        { id: 'svc-003', sortOrder: 2 },
      ]);

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE services SET sort_order'),
        [0, 'svc-001', 'tenant-001'],
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE services SET sort_order'),
        [1, 'svc-002', 'tenant-001'],
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE services SET sort_order'),
        [2, 'svc-003', 'tenant-001'],
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should rollback on error', async () => {
      const mockClient = {
        query: vi.fn(),
        release: vi.fn(),
      };
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('DB error')); // First update fails

      mockPool.connect.mockResolvedValueOnce(mockClient);

      await expect(
        service.reorder('tenant-001', [{ id: 'svc-001', sortOrder: 0 }]),
      ).rejects.toThrow('DB error');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should throw BadRequestException for empty items', async () => {
      await expect(service.reorder('tenant-001', [])).rejects.toThrow(BadRequestException);
    });
  });
});
