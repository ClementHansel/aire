/**
 * Unit tests for useMemberLookup hook.
 * Requirements: 6.5, 12.1, 12.2, 12.3
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMemberLookup } from './useMemberLookup';
import { MemberLookupResponse } from '@aire/shared/interfaces/member';

const mockMemberResponse: MemberLookupResponse = {
  customer: {
    id: 'cust-1',
    name: 'John Doe',
    phone: '6281234567890',
    plates: [
      { plate: 'B1234XYZ', brand: 'Toyota', model: 'Avanza' },
      { plate: 'D5678ABC', brand: 'Honda', model: 'Jazz' },
    ],
  },
  memberships: [
    {
      id: 'mem-1',
      planName: 'Gold Plan',
      status: 'active' as const,
      startDate: '2024-01-01',
      endDate: '2025-01-01',
      usesCount: 10,
      maxUses: 100,
      dailyLimit: 1,
      plates: [{ plate: 'B1234XYZ', brand: 'Toyota', model: 'Avanza' }],
      freeServices: ['svc-wash-basic'],
      discountedServices: [{ serviceId: 'svc-wash-premium', discountPct: 20 }],
      dailyUsageToday: { B1234XYZ: 0 },
    },
  ],
  vouchers: [],
};

describe('useMemberLookup', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize with null data and no loading/error state', () => {
    const { result } = renderHook(() => useMemberLookup());

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should perform phone lookup successfully', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMemberResponse),
    });

    const { result } = renderHook(() => useMemberLookup());

    let lookupResult: MemberLookupResponse | null = null;
    await act(async () => {
      lookupResult = await result.current.lookupByPhone('081234567890');
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/members/lookup?phone=081234567890');
    expect(lookupResult).toEqual(mockMemberResponse);
    expect(result.current.data).toEqual(mockMemberResponse);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should perform plate lookup successfully', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMemberResponse),
    });

    const { result } = renderHook(() => useMemberLookup());

    await act(async () => {
      await result.current.lookupByPlate('B 1234 XYZ');
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/members/lookup?plate=B+1234+XYZ');
    expect(result.current.data).toEqual(mockMemberResponse);
  });

  it('should prefer phone over plate in combined lookup', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMemberResponse),
    });

    const { result } = renderHook(() => useMemberLookup());

    await act(async () => {
      await result.current.lookup('081234567890', 'B1234XYZ');
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/members/lookup?phone=081234567890');
  });

  it('should fall back to plate lookup when phone is empty', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMemberResponse),
    });

    const { result } = renderHook(() => useMemberLookup());

    await act(async () => {
      await result.current.lookup('', 'B1234XYZ');
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/members/lookup?plate=B1234XYZ');
  });

  it('should set error when neither phone nor plate provided', async () => {
    const { result } = renderHook(() => useMemberLookup());

    await act(async () => {
      await result.current.lookup('', '');
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Provide a phone number or license plate to look up');
  });

  it('should handle 404 (customer not found)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ message: 'Not found' }),
    });

    const { result } = renderHook(() => useMemberLookup());

    let lookupResult: MemberLookupResponse | null = null;
    await act(async () => {
      lookupResult = await result.current.lookupByPhone('081234567890');
    });

    expect(lookupResult).toBeNull();
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('Customer not found');
  });

  it('should handle server error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: 'Internal server error' }),
    });

    const { result } = renderHook(() => useMemberLookup());

    await act(async () => {
      await result.current.lookupByPhone('081234567890');
    });

    expect(result.current.error).toBe('Internal server error');
    expect(result.current.data).toBeNull();
  });

  it('should handle network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Failed to fetch'));

    const { result } = renderHook(() => useMemberLookup());

    await act(async () => {
      await result.current.lookupByPhone('081234567890');
    });

    expect(result.current.error).toBe('Failed to fetch');
    expect(result.current.data).toBeNull();
  });

  it('should use custom base URL', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMemberResponse),
    });

    const { result } = renderHook(() =>
      useMemberLookup({ baseUrl: '/custom-api' }),
    );

    await act(async () => {
      await result.current.lookupByPhone('081234567890');
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/custom-api/members/lookup?phone=081234567890',
    );
  });

  it('should clear data and error on clear()', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMemberResponse),
    });

    const { result } = renderHook(() => useMemberLookup());

    await act(async () => {
      await result.current.lookupByPhone('081234567890');
    });

    expect(result.current.data).not.toBeNull();

    act(() => {
      result.current.clear();
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('should set error when phone is empty for lookupByPhone', async () => {
    const { result } = renderHook(() => useMemberLookup());

    await act(async () => {
      await result.current.lookupByPhone('');
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Phone number is required');
  });

  it('should set error when plate is empty for lookupByPlate', async () => {
    const { result } = renderHook(() => useMemberLookup());

    await act(async () => {
      await result.current.lookupByPlate('  ');
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.error).toBe('License plate is required');
  });
});
