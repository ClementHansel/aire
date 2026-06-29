/**
 * Unit tests for CustomerForm component.
 * Requirements: 6.4, 6.5, 6.6
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CustomerForm, CustomerFormData } from './CustomerForm';
import { MemberLookupResponse } from '@aire/shared/interfaces/member';
import { MembershipStatus } from '@aire/shared/enums';

const mockMemberResponse: MemberLookupResponse = {
  customer: {
    id: 'cust-1',
    name: 'John Doe',
    phone: '6281234567890',
    plates: [
      { plate: 'B1234XYZ', brand: 'Toyota', model: 'Avanza' },
    ],
  },
  memberships: [
    {
      id: 'mem-1',
      planName: 'Gold Plan',
      status: MembershipStatus.Active,
      startDate: '2024-01-01',
      endDate: '2025-01-01',
      usesCount: 10,
      maxUses: 100,
      dailyLimit: 1,
      plates: [{ plate: 'B1234XYZ', brand: 'Toyota', model: 'Avanza' }],
      freeServices: ['svc-basic'],
      discountedServices: [{ serviceId: 'svc-premium', discountPct: 20 }],
      dailyUsageToday: { B1234XYZ: 0 },
    },
  ],
  vouchers: [],
};

describe('CustomerForm', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const defaultValues: CustomerFormData = {
    name: '',
    phone: '',
    licensePlate: '',
    brand: '',
    model: '',
  };

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render all customer fields', () => {
    const onChange = vi.fn();
    render(<CustomerForm values={defaultValues} onChange={onChange} />);

    expect(screen.getByTestId('input-name')).toBeDefined();
    expect(screen.getByTestId('input-phone')).toBeDefined();
    expect(screen.getByTestId('input-plate')).toBeDefined();
    expect(screen.getByTestId('input-brand')).toBeDefined();
    expect(screen.getByTestId('input-model')).toBeDefined();
  });

  it('should render the Check button', () => {
    const onChange = vi.fn();
    render(<CustomerForm values={defaultValues} onChange={onChange} />);

    expect(screen.getByTestId('btn-check')).toBeDefined();
    expect(screen.getByTestId('btn-check').textContent).toBe('Check');
  });

  it('should disable Check button when both phone and plate are empty', () => {
    const onChange = vi.fn();
    render(<CustomerForm values={defaultValues} onChange={onChange} />);

    const checkBtn = screen.getByTestId('btn-check') as HTMLButtonElement;
    expect(checkBtn.disabled).toBe(true);
  });

  it('should enable Check button when phone is provided', () => {
    const onChange = vi.fn();
    const values = { ...defaultValues, phone: '081234567890' };
    render(<CustomerForm values={values} onChange={onChange} />);

    const checkBtn = screen.getByTestId('btn-check') as HTMLButtonElement;
    expect(checkBtn.disabled).toBe(false);
  });

  it('should enable Check button when plate is provided', () => {
    const onChange = vi.fn();
    const values = { ...defaultValues, licensePlate: 'B1234XYZ' };
    render(<CustomerForm values={values} onChange={onChange} />);

    const checkBtn = screen.getByTestId('btn-check') as HTMLButtonElement;
    expect(checkBtn.disabled).toBe(false);
  });

  it('should call onChange when name field changes', () => {
    const onChange = vi.fn();
    render(<CustomerForm values={defaultValues} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('input-name'), {
      target: { value: 'Jane' },
    });

    expect(onChange).toHaveBeenCalledWith({
      ...defaultValues,
      name: 'Jane',
    });
  });

  it('should call onChange when phone field changes', () => {
    const onChange = vi.fn();
    render(<CustomerForm values={defaultValues} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('input-phone'), {
      target: { value: '081234567890' },
    });

    expect(onChange).toHaveBeenCalledWith({
      ...defaultValues,
      phone: '081234567890',
    });
  });

  it('should call onChange when plate field changes', () => {
    const onChange = vi.fn();
    render(<CustomerForm values={defaultValues} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('input-plate'), {
      target: { value: 'B 1234 XYZ' },
    });

    expect(onChange).toHaveBeenCalledWith({
      ...defaultValues,
      licensePlate: 'B 1234 XYZ',
    });
  });

  it('should call onChange when brand field changes', () => {
    const onChange = vi.fn();
    render(<CustomerForm values={defaultValues} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('input-brand'), {
      target: { value: 'Honda' },
    });

    expect(onChange).toHaveBeenCalledWith({
      ...defaultValues,
      brand: 'Honda',
    });
  });

  it('should call onChange when model field changes', () => {
    const onChange = vi.fn();
    render(<CustomerForm values={defaultValues} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('input-model'), {
      target: { value: 'Jazz' },
    });

    expect(onChange).toHaveBeenCalledWith({
      ...defaultValues,
      model: 'Jazz',
    });
  });

  it('should perform member lookup and auto-fill fields on Check', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMemberResponse),
    });

    const onChange = vi.fn();
    const onMemberFound = vi.fn();
    const values = { ...defaultValues, phone: '081234567890' };

    render(
      <CustomerForm
        values={values}
        onChange={onChange}
        onMemberFound={onMemberFound}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-check'));
    });

    // Should auto-fill from lookup response
    expect(onChange).toHaveBeenCalledWith({
      name: 'John Doe',
      phone: '6281234567890',
      licensePlate: 'B1234XYZ',
      brand: 'Toyota',
      model: 'Avanza',
    });

    expect(onMemberFound).toHaveBeenCalledWith(mockMemberResponse);
  });

  it('should display membership banner when member data is available', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMemberResponse),
    });

    const onChange = vi.fn();
    const values = { ...defaultValues, phone: '081234567890' };

    render(<CustomerForm values={values} onChange={onChange} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-check'));
    });

    expect(screen.getByTestId('member-banner')).toBeDefined();
    expect(screen.getByTestId('plan-name-mem-1').textContent).toBe('Gold Plan');
  });

  it('should display error when lookup fails with 404', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ message: 'Not found' }),
    });

    const onChange = vi.fn();
    const values = { ...defaultValues, phone: '081234567890' };

    render(<CustomerForm values={values} onChange={onChange} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-check'));
    });

    expect(screen.getByTestId('lookup-error')).toBeDefined();
    expect(screen.getByTestId('lookup-error').textContent).toBe('Customer not found');
  });

  it('should display membership banner with external member data', () => {
    const onChange = vi.fn();

    render(
      <CustomerForm
        values={defaultValues}
        onChange={onChange}
        memberData={mockMemberResponse}
      />,
    );

    expect(screen.getByTestId('member-banner')).toBeDefined();
  });

  it('should show loading state during lookup', async () => {
    let resolvePromise: (value: unknown) => void;
    const pendingPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    fetchMock.mockReturnValueOnce(pendingPromise);

    const onChange = vi.fn();
    const values = { ...defaultValues, phone: '081234567890' };

    render(<CustomerForm values={values} onChange={onChange} />);

    // Start the lookup (don't await it)
    act(() => {
      fireEvent.click(screen.getByTestId('btn-check'));
    });

    // Button should show loading
    await waitFor(() => {
      expect(screen.getByTestId('btn-check').textContent).toBe('Checking...');
    });

    // Resolve the promise
    await act(async () => {
      resolvePromise!({
        ok: true,
        json: () => Promise.resolve(mockMemberResponse),
      });
    });

    // Button should return to normal
    await waitFor(() => {
      expect(screen.getByTestId('btn-check').textContent).toBe('Check');
    });
  });

  it('should mark Name and Phone fields as required', () => {
    const onChange = vi.fn();
    render(<CustomerForm values={defaultValues} onChange={onChange} />);

    const nameInput = screen.getByTestId('input-name') as HTMLInputElement;
    const phoneInput = screen.getByTestId('input-phone') as HTMLInputElement;

    expect(nameInput.required).toBe(true);
    expect(phoneInput.required).toBe(true);
  });

  it('should have proper ARIA labels on the Check button', () => {
    const onChange = vi.fn();
    render(<CustomerForm values={defaultValues} onChange={onChange} />);

    const checkBtn = screen.getByTestId('btn-check');
    expect(checkBtn.getAttribute('aria-label')).toBe('Check member status');
  });
});
