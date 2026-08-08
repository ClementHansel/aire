/**
 * Unit tests for MemberManagementPanel — the POS membership CRUD surface
 * (view plates/status, edit plates via PUT .../plates, cancel via PATCH
 * .../cancel).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemberManagementPanel } from './MemberManagementPanel';
import type { MemberLookupResponse } from '@aire/shared/interfaces/member';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/i18n', () => ({
  useI18n: () => ({ t: (_k: string, fallback?: string) => fallback ?? _k }),
}));

const mockApi = api as unknown as {
  put: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
};

function makeMember(overrides: Partial<MemberLookupResponse['memberships'][number]> = {}): MemberLookupResponse {
  return {
    customer: { id: 'cust-1', name: 'Budi', phone: '6281234567890', plates: [] },
    memberships: [
      {
        id: 'mem-1',
        planName: 'Gold Plan',
        status: 'active' as const,
        startDate: '2024-01-01',
        endDate: '2025-01-01',
        usesCount: 5,
        maxUses: 30,
        dailyLimit: 1,
        maxPlates: 2,
        plates: [{ plate: 'B1234ABC', brand: 'Toyota', model: 'Avanza' }],
        freeServices: [],
        discountedServices: [],
        dailyUsageToday: {},
        ...overrides,
      },
    ],
  };
}

describe('MemberManagementPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows plan, status, and registered plates', () => {
    render(<MemberManagementPanel member={makeMember()} onChanged={vi.fn()} />);
    expect(screen.getByText('Gold Plan')).toBeInTheDocument();
    expect(screen.getByTestId('member-status-mem-1')).toHaveTextContent('active');
    expect(screen.getByTestId('member-plate-B1234ABC')).toHaveTextContent('B1234ABC (Toyota Avanza)');
  });

  it('shows a Cancel membership action for an active membership but not a cancelled one', () => {
    const { rerender } = render(<MemberManagementPanel member={makeMember()} onChanged={vi.fn()} />);
    expect(screen.getByText('Cancel membership')).toBeInTheDocument();

    rerender(<MemberManagementPanel member={makeMember({ status: 'cancelled' as any })} onChanged={vi.fn()} />);
    expect(screen.queryByText('Cancel membership')).not.toBeInTheDocument();
  });

  it('opens the plate editor pre-filled with the existing plate, and blocks saving an empty first row', async () => {
    render(<MemberManagementPanel member={makeMember()} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByText('Edit plates'));

    const firstPlateInput = screen.getByTestId('edit-plate-input-0') as HTMLInputElement;
    expect(firstPlateInput.value).toBe('B1234ABC');

    fireEvent.change(firstPlateInput, { target: { value: '' } });
    fireEvent.click(screen.getByText('Save plates'));

    expect(await screen.findByText('Register at least one plate.')).toBeInTheDocument();
    expect(mockApi.put).not.toHaveBeenCalled();
  });

  it('caps "Add license plate" at the plan max_plates', () => {
    render(<MemberManagementPanel member={makeMember()} onChanged={vi.fn()} />); // maxPlates: 2
    fireEvent.click(screen.getByText('Edit plates'));

    expect(screen.getByText('+ Add license plate')).toBeInTheDocument();
    fireEvent.click(screen.getByText('+ Add license plate'));
    // Now at 2 rows == maxPlates(2) — the add button must disappear.
    expect(screen.queryByText('+ Add license plate')).not.toBeInTheDocument();
  });

  it('saves the edited plate list via PUT and calls onChanged', async () => {
    mockApi.put.mockResolvedValue({});
    const onChanged = vi.fn();
    render(<MemberManagementPanel member={makeMember()} onChanged={onChanged} />);

    fireEvent.click(screen.getByText('Edit plates'));
    fireEvent.click(screen.getByText('Save plates'));

    await waitFor(() => expect(mockApi.put).toHaveBeenCalledWith(
      '/memberships/mem-1/plates',
      { plates: [{ plate: 'B1234ABC', brand: 'Toyota', model: 'Avanza' }] },
    ));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  describe('brand picker (AIRIN-153)', () => {
    const BRANDS = [
      { id: 'b1', name: 'Toyota', types: [{ id: 't1', name: 'Avanza' }] },
      { id: 'b2', name: 'Honda', types: [{ id: 't2', name: 'Brio' }] },
    ];

    it('offers the brand as a choice, not free text, when a catalog is given', () => {
      render(<MemberManagementPanel member={makeMember()} onChanged={vi.fn()} vehicleBrands={BRANDS} />);
      fireEvent.click(screen.getByText('Edit plates'));

      const brand = screen.getByLabelText('Brand') as HTMLSelectElement;
      expect(brand.tagName).toBe('SELECT');
      expect(brand.value).toBe('Toyota');
      expect(screen.getByRole('option', { name: 'Honda' })).toBeInTheDocument();
    });

    it('refuses to save a plate with no brand chosen', async () => {
      render(<MemberManagementPanel member={makeMember()} onChanged={vi.fn()} vehicleBrands={BRANDS} />);
      fireEvent.click(screen.getByText('Edit plates'));

      fireEvent.change(screen.getByLabelText('Brand'), { target: { value: '' } });
      fireEvent.click(screen.getByText('Save plates'));

      expect(await screen.findByText('Pick a brand for every plate.')).toBeInTheDocument();
      expect(mockApi.put).not.toHaveBeenCalled();
    });

    it('clears the type when the brand changes, so the two can never disagree', () => {
      render(<MemberManagementPanel member={makeMember()} onChanged={vi.fn()} vehicleBrands={BRANDS} />);
      fireEvent.click(screen.getByText('Edit plates'));

      const model = screen.getByPlaceholderText('Model') as HTMLInputElement;
      expect(model.value).toBe('Avanza');
      fireEvent.change(screen.getByLabelText('Brand'), { target: { value: 'Honda' } });
      expect((screen.getByPlaceholderText('Model') as HTMLInputElement).value).toBe('');
    });
  });

  it('cancels a membership via PATCH after confirm', async () => {
    mockApi.patch.mockResolvedValue({ ok: true });
    const onChanged = vi.fn();
    render(<MemberManagementPanel member={makeMember()} onChanged={onChanged} />);

    fireEvent.click(screen.getByText('Cancel membership'));
    fireEvent.change(screen.getByPlaceholderText('Reason (optional)'), { target: { value: 'no longer needed' } });
    fireEvent.click(screen.getByText('Confirm cancel'));

    await waitFor(() => expect(mockApi.patch).toHaveBeenCalledWith(
      '/memberships/mem-1/cancel',
      { reason: 'no longer needed' },
    ));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});
