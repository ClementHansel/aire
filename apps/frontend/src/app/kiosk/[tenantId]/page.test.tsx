/**
 * Unit tests for Kiosk PWA interface.
 * Requirements: 27.1, 27.3
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import KioskPage, { QueueStatus } from './page';

const mockQueueStatus: QueueStatus = {
  orderNumber: 'ORD-001',
  position: 3,
  estimatedWaitMinutes: 12,
  status: 'queued',
  assignedBay: undefined,
};

const mockQueueStatusWithBay: QueueStatus = {
  orderNumber: 'ORD-002',
  position: 1,
  estimatedWaitMinutes: 2,
  status: 'in_progress',
  assignedBay: 'Bay 2',
};

describe('KioskPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const defaultParams = { tenantId: 'tenant-123' };

  it('should render the kiosk page with header', () => {
    render(<KioskPage params={defaultParams} />);

    expect(screen.getByTestId('kiosk-page')).toBeDefined();
    expect(screen.getByTestId('kiosk-header')).toBeDefined();
    expect(screen.getByText('Self-Service Queue Check')).toBeDefined();
  });

  it('should render the order number input field', () => {
    render(<KioskPage params={defaultParams} />);

    const input = screen.getByTestId('input-order-number') as HTMLInputElement;
    expect(input).toBeDefined();
    expect(input.placeholder).toBe('e.g. ORD-001');
    expect(input.getAttribute('aria-label')).toBe('Order number');
  });

  it('should render the Check Queue button', () => {
    render(<KioskPage params={defaultParams} />);

    const btn = screen.getByTestId('btn-check-queue');
    expect(btn).toBeDefined();
    expect(btn.textContent).toBe('Check Queue');
  });

  it('should disable Check Queue button when input is empty', () => {
    render(<KioskPage params={defaultParams} />);

    const btn = screen.getByTestId('btn-check-queue') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('should enable Check Queue button when order number is entered', () => {
    render(<KioskPage params={defaultParams} />);

    const input = screen.getByTestId('input-order-number');
    fireEvent.change(input, { target: { value: 'ORD-001' } });

    const btn = screen.getByTestId('btn-check-queue') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('should disable Check Queue button when input is only whitespace', () => {
    render(<KioskPage params={defaultParams} />);

    const input = screen.getByTestId('input-order-number');
    fireEvent.change(input, { target: { value: '   ' } });

    const btn = screen.getByTestId('btn-check-queue') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('should fetch queue status on button click', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockQueueStatus),
    });

    render(<KioskPage params={defaultParams} />);

    const input = screen.getByTestId('input-order-number');
    fireEvent.change(input, { target: { value: 'ORD-001' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-check-queue'));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/kiosk/tenant-123/queue-status?orderNumber=ORD-001',
    );
  });

  it('should display queue status after successful fetch', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockQueueStatus),
    });

    render(<KioskPage params={defaultParams} />);

    const input = screen.getByTestId('input-order-number');
    fireEvent.change(input, { target: { value: 'ORD-001' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-check-queue'));
    });

    expect(screen.getByTestId('queue-status')).toBeDefined();
    expect(screen.getByTestId('display-order-number').textContent).toBe('ORD-001');
    expect(screen.getByTestId('display-position').textContent).toContain('#3');
    expect(screen.getByTestId('display-wait-time').textContent).toContain('12 min');
    expect(screen.getByTestId('display-status').textContent).toContain('In Queue');
  });

  it('should display assigned bay when available', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockQueueStatusWithBay),
    });

    render(<KioskPage params={defaultParams} />);

    const input = screen.getByTestId('input-order-number');
    fireEvent.change(input, { target: { value: 'ORD-002' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-check-queue'));
    });

    expect(screen.getByTestId('display-bay')).toBeDefined();
    expect(screen.getByTestId('display-bay').textContent).toContain('Bay 2');
  });

  it('should not display bay section when no bay assigned', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockQueueStatus),
    });

    render(<KioskPage params={defaultParams} />);

    const input = screen.getByTestId('input-order-number');
    fireEvent.change(input, { target: { value: 'ORD-001' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-check-queue'));
    });

    expect(screen.queryByTestId('display-bay')).toBeNull();
  });

  it('should display error when order is not found (404)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ message: 'Not found' }),
    });

    render(<KioskPage params={defaultParams} />);

    const input = screen.getByTestId('input-order-number');
    fireEvent.change(input, { target: { value: 'INVALID' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-check-queue'));
    });

    expect(screen.getByTestId('queue-error')).toBeDefined();
    expect(screen.getByTestId('queue-error').textContent).toBe(
      'Order not found. Please check your order number.',
    );
  });

  it('should display error on server error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: 'Server error' }),
    });

    render(<KioskPage params={defaultParams} />);

    const input = screen.getByTestId('input-order-number');
    fireEvent.change(input, { target: { value: 'ORD-001' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-check-queue'));
    });

    expect(screen.getByTestId('queue-error')).toBeDefined();
    expect(screen.getByTestId('queue-error').textContent).toBe(
      'Unable to check queue status. Please try again.',
    );
  });

  it('should display error on network failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network error'));

    render(<KioskPage params={defaultParams} />);

    const input = screen.getByTestId('input-order-number');
    fireEvent.change(input, { target: { value: 'ORD-001' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-check-queue'));
    });

    expect(screen.getByTestId('queue-error')).toBeDefined();
    expect(screen.getByTestId('queue-error').textContent).toBe(
      'Connection error. Please check your internet and try again.',
    );
  });

  it('should show loading state while fetching', async () => {
    let resolvePromise: (value: unknown) => void;
    const pendingPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    fetchMock.mockReturnValueOnce(pendingPromise);

    render(<KioskPage params={defaultParams} />);

    const input = screen.getByTestId('input-order-number');
    fireEvent.change(input, { target: { value: 'ORD-001' } });

    act(() => {
      fireEvent.click(screen.getByTestId('btn-check-queue'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('btn-check-queue').textContent).toBe('Checking...');
    });

    // Input should be disabled during loading
    const inputEl = screen.getByTestId('input-order-number') as HTMLInputElement;
    expect(inputEl.disabled).toBe(true);

    // Resolve the promise
    await act(async () => {
      resolvePromise!({
        ok: true,
        json: () => Promise.resolve(mockQueueStatus),
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('btn-check-queue').textContent).toBe('Check Queue');
    });
  });

  it('should submit on Enter key press', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockQueueStatus),
    });

    render(<KioskPage params={defaultParams} />);

    const input = screen.getByTestId('input-order-number');
    fireEvent.change(input, { target: { value: 'ORD-001' } });

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    });

    expect(fetchMock).toHaveBeenCalled();
  });

  it('should clear previous error on new search', async () => {
    // First call: 404
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ message: 'Not found' }),
    });

    render(<KioskPage params={defaultParams} />);

    const input = screen.getByTestId('input-order-number');
    fireEvent.change(input, { target: { value: 'INVALID' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-check-queue'));
    });

    expect(screen.getByTestId('queue-error')).toBeDefined();

    // Second call: success
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockQueueStatus),
    });

    fireEvent.change(input, { target: { value: 'ORD-001' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-check-queue'));
    });

    expect(screen.queryByTestId('queue-error')).toBeNull();
    expect(screen.getByTestId('queue-status')).toBeDefined();
  });

  it('should format status correctly for all status types', async () => {
    const statuses: Array<{ status: QueueStatus['status']; display: string }> = [
      { status: 'queued', display: 'In Queue' },
      { status: 'in_progress', display: 'In Progress' },
      { status: 'completed', display: 'Completed' },
      { status: 'cancelled', display: 'Cancelled' },
    ];

    for (const { status, display } of statuses) {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ...mockQueueStatus, status }),
      });

      const { unmount } = render(<KioskPage params={defaultParams} />);

      const input = screen.getByTestId('input-order-number');
      fireEvent.change(input, { target: { value: 'ORD-001' } });

      await act(async () => {
        fireEvent.click(screen.getByTestId('btn-check-queue'));
      });

      expect(screen.getByTestId('display-status').textContent).toContain(display);
      unmount();
    }
  });

  it('should have proper accessibility attributes', () => {
    render(<KioskPage params={defaultParams} />);

    const btn = screen.getByTestId('btn-check-queue');
    expect(btn.getAttribute('aria-label')).toBe('Check queue status');

    const input = screen.getByTestId('input-order-number');
    expect(input.getAttribute('aria-label')).toBe('Order number');
  });
});
