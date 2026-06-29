import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ERR_MEMBERSHIP_NOT_FOUND, ERR_MEMBERSHIP_MAX_PLATES_EXCEEDED } from '@aire/shared';
import { MembershipPlateService } from './membership-plate.service';
import { MembershipPlateRow } from './interfaces';

describe('MembershipPlateService', () => {
  let service: MembershipPlateService;
  let mockPool: { query: ReturnType<typeof vi.fn> };

  const membershipId = 'membership-001';
  const plateId = 'plate-001';
  const operatorId = 'operator-001';

  const mockPlateRow: MembershipPlateRow = {
    id: plateId,
    membership_id: membershipId,
    plate: 'B 1234 ABC',
    plate_normalized: 'B1234ABC',
    brand: 'Toyota',
    model: 'Avanza',
    created_at: new Date('2024-01-15'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = { query: vi.fn() };
    service = new MembershipPlateService(mockPool as any);
  });

  describe('addPlate', () => {
    it('should add a plate when under max_plates limit', async () => {
      // getMaxPlatesForMembership: join query returns max_plates
      mockPool.query.mockResolvedValueOnce({ rows: [{ max_plates: 3 }] });
      // getPlateCount: returns current count
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
      // INSERT returning the new plate
      mockPool.query.mockResolvedValueOnce({ rows: [mockPlateRow] });
      // audit log INSERT (SELECT from memberships)
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.addPlate(membershipId, 'B 1234 ABC', 'Toyota', 'Avanza', operatorId);

      expect(result.id).toBe(plateId);
      expect(result.membershipId).toBe(membershipId);
      expect(result.plate).toBe('B 1234 ABC');
      expect(result.plateNormalized).toBe('B1234ABC');
      expect(result.brand).toBe('Toyota');
      expect(result.model).toBe('Avanza');
    });

    it('should reject adding plate when at max_plates limit', async () => {
      // max_plates is 3, current count is 3
      mockPool.query.mockResolvedValueOnce({ rows: [{ max_plates: 3 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '3' }] });

      await expect(
        service.addPlate(membershipId, 'B 5678 XYZ', 'Honda', 'Jazz', operatorId),
      ).rejects.toThrow(BadRequestException);

      // Verify the error code
      try {
        mockPool.query.mockResolvedValueOnce({ rows: [{ max_plates: 3 }] });
        mockPool.query.mockResolvedValueOnce({ rows: [{ count: '3' }] });
        await service.addPlate(membershipId, 'B 5678 XYZ');
      } catch (e: any) {
        expect(e.message).toBe(ERR_MEMBERSHIP_MAX_PLATES_EXCEEDED);
      }
    });

    it('should throw NotFoundException when membership does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // no membership found

      await expect(
        service.addPlate('nonexistent-membership', 'B 1234 ABC'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should normalize plate before storing', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ max_plates: 3 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockPlateRow] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.addPlate(membershipId, 'b 1234 abc');

      // Check the INSERT query params — plate_normalized should be uppercase no spaces
      const insertCall = mockPool.query.mock.calls[2];
      const params = insertCall[1];
      expect(params[2]).toBe('B1234ABC'); // plate_normalized
    });

    it('should create audit log entry on successful add', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ max_plates: 3 }] });
      mockPool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
      mockPool.query.mockResolvedValueOnce({ rows: [mockPlateRow] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.addPlate(membershipId, 'B 1234 ABC', 'Toyota', 'Avanza', operatorId);

      // Verify audit log was called (4th query)
      expect(mockPool.query).toHaveBeenCalledTimes(4);
      const auditCall = mockPool.query.mock.calls[3];
      const auditQuery = auditCall[0] as string;
      expect(auditQuery).toContain('INSERT INTO audit_logs');
      const auditParams = auditCall[1];
      expect(auditParams[1]).toBe(operatorId); // user_id
      expect(auditParams[2]).toBe('plate_added'); // operation
      expect(auditParams[3]).toBe('membership_plate'); // entity_type
    });
  });

  describe('updatePlate', () => {
    it('should update an existing plate', async () => {
      // getPlateById (existing plate)
      mockPool.query.mockResolvedValueOnce({ rows: [mockPlateRow] });
      // UPDATE returning updated plate
      const updatedRow: MembershipPlateRow = {
        ...mockPlateRow,
        plate: 'D 9999 ZZZ',
        plate_normalized: 'D9999ZZZ',
        brand: 'Honda',
        model: 'Civic',
      };
      mockPool.query.mockResolvedValueOnce({ rows: [updatedRow] });
      // audit log
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.updatePlate(plateId, 'D 9999 ZZZ', 'Honda', 'Civic', operatorId);

      expect(result.plate).toBe('D 9999 ZZZ');
      expect(result.plateNormalized).toBe('D9999ZZZ');
      expect(result.brand).toBe('Honda');
      expect(result.model).toBe('Civic');
    });

    it('should throw NotFoundException if plate does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // getPlateById returns nothing

      await expect(
        service.updatePlate('nonexistent-plate', 'X 1234 ABC'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should normalize the new plate value', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockPlateRow] });
      const updatedRow: MembershipPlateRow = {
        ...mockPlateRow,
        plate: 'ab 123 cd',
        plate_normalized: 'AB123CD',
      };
      mockPool.query.mockResolvedValueOnce({ rows: [updatedRow] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.updatePlate(plateId, 'ab 123 cd');

      const updateCall = mockPool.query.mock.calls[1];
      const params = updateCall[1];
      expect(params[1]).toBe('AB123CD'); // plate_normalized
    });

    it('should create audit log with before and after values', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockPlateRow] });
      const updatedRow: MembershipPlateRow = {
        ...mockPlateRow,
        plate: 'D 5555 EFG',
        plate_normalized: 'D5555EFG',
        brand: 'Mazda',
        model: 'CX-5',
      };
      mockPool.query.mockResolvedValueOnce({ rows: [updatedRow] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.updatePlate(plateId, 'D 5555 EFG', 'Mazda', 'CX-5', operatorId);

      const auditCall = mockPool.query.mock.calls[2];
      const auditParams = auditCall[1];
      expect(auditParams[2]).toBe('plate_updated');
      // before_value contains old plate info
      const beforeValue = JSON.parse(auditParams[5]);
      expect(beforeValue.plate).toBe('B 1234 ABC');
      // after_value contains new plate info
      const afterValue = JSON.parse(auditParams[6]);
      expect(afterValue.plate).toBe('D 5555 EFG');
    });
  });

  describe('removePlate', () => {
    it('should remove an existing plate', async () => {
      // getPlateById
      mockPool.query.mockResolvedValueOnce({ rows: [mockPlateRow] });
      // DELETE
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 });
      // audit log
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.removePlate(plateId, operatorId)).resolves.toBeUndefined();
    });

    it('should throw NotFoundException if plate does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // getPlateById

      await expect(
        service.removePlate('nonexistent-plate', operatorId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create audit log with before value and null after', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [mockPlateRow] });
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.removePlate(plateId, operatorId);

      const auditCall = mockPool.query.mock.calls[2];
      const auditParams = auditCall[1];
      expect(auditParams[2]).toBe('plate_removed');
      const beforeValue = JSON.parse(auditParams[5]);
      expect(beforeValue.plate).toBe('B 1234 ABC');
      expect(auditParams[6]).toBeNull(); // after_value is null
    });
  });

  describe('getPlates', () => {
    it('should return all plates for a membership', async () => {
      const secondPlateRow: MembershipPlateRow = {
        id: 'plate-002',
        membership_id: membershipId,
        plate: 'D 5678 XYZ',
        plate_normalized: 'D5678XYZ',
        brand: 'Honda',
        model: 'Jazz',
        created_at: new Date('2024-02-01'),
      };
      mockPool.query.mockResolvedValueOnce({ rows: [mockPlateRow, secondPlateRow] });

      const result = await service.getPlates(membershipId);

      expect(result).toHaveLength(2);
      expect(result[0]!.plateNormalized).toBe('B1234ABC');
      expect(result[1]!.plateNormalized).toBe('D5678XYZ');
    });

    it('should return empty array when no plates exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.getPlates(membershipId);
      expect(result).toEqual([]);
    });
  });

  describe('releasePlates', () => {
    it('should delete all plates for a membership on cancellation/expiry', async () => {
      // getPlates query
      mockPool.query.mockResolvedValueOnce({ rows: [mockPlateRow] });
      // DELETE all
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 });
      // audit log
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.releasePlates(membershipId)).resolves.toBeUndefined();

      // Verify DELETE was called
      const deleteCall = mockPool.query.mock.calls[1];
      expect(deleteCall[0]).toContain('DELETE FROM membership_plates WHERE membership_id');
      expect(deleteCall[1][0]).toBe(membershipId);
    });

    it('should do nothing when no plates exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // no plates

      await service.releasePlates(membershipId);

      // Only 1 query (the SELECT) should have been called
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it('should create audit log with all released plates in before_value', async () => {
      const plates: MembershipPlateRow[] = [
        mockPlateRow,
        { ...mockPlateRow, id: 'plate-002', plate: 'D 5678 XYZ', plate_normalized: 'D5678XYZ' },
      ];
      mockPool.query.mockResolvedValueOnce({ rows: plates });
      mockPool.query.mockResolvedValueOnce({ rowCount: 2 });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.releasePlates(membershipId);

      const auditCall = mockPool.query.mock.calls[2];
      const auditParams = auditCall[1];
      expect(auditParams[2]).toBe('plates_released');
      const beforeValue = JSON.parse(auditParams[5]);
      expect(beforeValue.plates).toHaveLength(2);
      expect(auditParams[6]).toBeNull(); // after_value is null
    });
  });
});
