/**
 * Unit tests for OrderCard component.
 * Requirements: 20.2, 20.5, 20.6, 20.7
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OrderCard, PromoChipType } from './OrderCard';
import { OrderStatus, PaymentMethod } from '@aire/shared/enums';
import type { OrderCard as OrderCardData } from '@aire/shared/interfaces/order';

function createMockOrder(overrides?: Partial<OrderCardData>): OrderCardData {
  return {
    id: 'order-1',
    orderNumber: 'ORD-001',
    customerName: 'John Doe',
    customerPhone: '6281234567890',
    licensePlate: 'B1234ABC',
    vehicleBrand: 'Toyota',
    operatorName: 'Cashier A',
    status: OrderStatus.Ordered,
    items: [
      { serviceName: 'Super Wash', quantity: 1, subtotal: 80000 },
      { serviceName: 'Interior Clean', quantity: 1, subtotal: 50000 },
    ],
    total: 130000,
    createdAt: '2026-06-28T10:00:00Z',
    ...overrides,
  };
}

describe('OrderCard', () => {
  const defaultOnSettle = vi.fn();
  const defaultOnReceiptReprint = vi.fn();
  const defaultOnVoid = vi.fn();

  beforeEach(() => {
    defaultOnSettle.mockClear();
    defaultOnReceiptReprint.mockClear();
    defaultOnVoid.mockClear();
  });

  describe('Requirement 20.5: Order card content', () => {
    it('should display order number', () => {
      const order = createMockOrder();
      render(<OrderCard order={order} />);

      expect(screen.getByTestId('order-number').textContent).toContain('ORD-001');
    });

    it('should display customer name', () => {
      const order = createMockOrder();
      render(<OrderCard order={order} />);

      expect(screen.getByTestId('order-customer-name').textContent).toBe('John Doe');
    });

    it('should display brand chip when vehicle brand is present', () => {
      const order = createMockOrder({ vehicleBrand: 'Honda' });
      render(<OrderCard order={order} />);

      expect(screen.getByTestId('order-brand-chip').textContent).toBe('Honda');
    });

    it('should not display brand chip when vehicle brand is absent', () => {
      const order = createMockOrder({ vehicleBrand: undefined });
      render(<OrderCard order={order} />);

      expect(screen.queryByTestId('order-brand-chip')).toBeNull();
    });

    it('should display operator name', () => {
      const order = createMockOrder();
      render(<OrderCard order={order} />);

      expect(screen.getByTestId('order-operator').textContent).toContain('Cashier A');
    });

    it('should display status badge with correct label', () => {
      const order = createMockOrder({ status: OrderStatus.Paid });
      render(<OrderCard order={order} />);

      const badge = screen.getByTestId('order-status-badge');
      expect(badge.textContent).toBe('Paid');
    });

    it('should display color-coded status badge for Ordered', () => {
      const order = createMockOrder({ status: OrderStatus.Ordered });
      render(<OrderCard order={order} />);

      const badge = screen.getByTestId('order-status-badge');
      expect(badge.style.backgroundColor).toBe('rgb(245, 158, 11)');
    });

    it('should display color-coded status badge for Completed', () => {
      const order = createMockOrder({ status: OrderStatus.Completed });
      render(<OrderCard order={order} />);

      const badge = screen.getByTestId('order-status-badge');
      expect(badge.style.backgroundColor).toBe('rgb(16, 185, 129)');
    });

    it('should display color-coded status badge for Cancelled', () => {
      const order = createMockOrder({ status: OrderStatus.Cancelled });
      render(<OrderCard order={order} />);

      const badge = screen.getByTestId('order-status-badge');
      expect(badge.style.backgroundColor).toBe('rgb(239, 68, 68)');
    });

    it('should display all order items with quantity and subtotal', () => {
      const order = createMockOrder();
      render(<OrderCard order={order} />);

      const itemsContainer = screen.getByTestId('order-items');
      expect(itemsContainer.textContent).toContain('1x Super Wash');
      expect(itemsContainer.textContent).toContain('1x Interior Clean');
      expect(itemsContainer.textContent).toContain('80,000');
      expect(itemsContainer.textContent).toContain('50,000');
    });

    it('should display total amount', () => {
      const order = createMockOrder({ total: 130000 });
      render(<OrderCard order={order} />);

      expect(screen.getByTestId('order-total').textContent).toContain('130,000');
    });

    it('should display promo chips when provided', () => {
      const order = createMockOrder();
      const promoChips: PromoChipType[] = ['member', 'voucher'];
      render(<OrderCard order={order} promoChips={promoChips} />);

      expect(screen.getByTestId('promo-chip-member').textContent).toBe('Member');
      expect(screen.getByTestId('promo-chip-voucher').textContent).toBe('Voucher');
    });

    it('should not render promo chips section when none provided', () => {
      const order = createMockOrder();
      render(<OrderCard order={order} />);

      expect(screen.queryByTestId('order-promo-chips')).toBeNull();
    });

    it('should display sold membership promo chip', () => {
      const order = createMockOrder();
      render(<OrderCard order={order} promoChips={['sold_membership']} />);

      expect(screen.getByTestId('promo-chip-sold_membership').textContent).toBe('Sold: Membership');
    });
  });

  describe('Requirement 20.6: Settle unpaid orders (Cash/QRIS only)', () => {
    it('should show settle button for unpaid (Ordered) orders', () => {
      const order = createMockOrder({ status: OrderStatus.Ordered });
      render(<OrderCard order={order} onSettle={defaultOnSettle} />);

      expect(screen.getByTestId('settle-btn')).toBeDefined();
    });

    it('should not show settle button for paid orders', () => {
      const order = createMockOrder({ status: OrderStatus.Paid });
      render(<OrderCard order={order} onSettle={defaultOnSettle} />);

      expect(screen.queryByTestId('settle-btn')).toBeNull();
    });

    it('should not show settle button for completed orders', () => {
      const order = createMockOrder({ status: OrderStatus.Completed });
      render(<OrderCard order={order} onSettle={defaultOnSettle} />);

      expect(screen.queryByTestId('settle-btn')).toBeNull();
    });

    it('should show Cash and QRIS options when settle is clicked', () => {
      const order = createMockOrder({ status: OrderStatus.Ordered });
      render(<OrderCard order={order} onSettle={defaultOnSettle} />);

      fireEvent.click(screen.getByTestId('settle-btn'));

      expect(screen.getByTestId('settle-options')).toBeDefined();
      expect(screen.getByTestId('settle-cash-btn')).toBeDefined();
      expect(screen.getByTestId('settle-qris-btn')).toBeDefined();
    });

    it('should call onSettle with Cash method when Cash is selected', () => {
      const order = createMockOrder({ status: OrderStatus.Ordered });
      render(<OrderCard order={order} onSettle={defaultOnSettle} />);

      fireEvent.click(screen.getByTestId('settle-btn'));
      fireEvent.click(screen.getByTestId('settle-cash-btn'));

      expect(defaultOnSettle).toHaveBeenCalledWith('order-1', PaymentMethod.Cash);
    });

    it('should call onSettle with QRIS method when QRIS is selected', () => {
      const order = createMockOrder({ status: OrderStatus.Ordered });
      render(<OrderCard order={order} onSettle={defaultOnSettle} />);

      fireEvent.click(screen.getByTestId('settle-btn'));
      fireEvent.click(screen.getByTestId('settle-qris-btn'));

      expect(defaultOnSettle).toHaveBeenCalledWith('order-1', PaymentMethod.QrisStatic);
    });

    it('should hide settle options when cancel is clicked', () => {
      const order = createMockOrder({ status: OrderStatus.Ordered });
      render(<OrderCard order={order} onSettle={defaultOnSettle} />);

      fireEvent.click(screen.getByTestId('settle-btn'));
      expect(screen.getByTestId('settle-options')).toBeDefined();

      fireEvent.click(screen.getByTestId('settle-cancel-btn'));
      expect(screen.queryByTestId('settle-options')).toBeNull();
    });

    it('should not show settle button when onSettle is not provided', () => {
      const order = createMockOrder({ status: OrderStatus.Ordered });
      render(<OrderCard order={order} />);

      expect(screen.queryByTestId('settle-btn')).toBeNull();
    });
  });

  describe('Requirement 20.7: Receipt reprint', () => {
    it('should show receipt button when onReceiptReprint is provided', () => {
      const order = createMockOrder();
      render(<OrderCard order={order} onReceiptReprint={defaultOnReceiptReprint} />);

      expect(screen.getByTestId('receipt-btn')).toBeDefined();
    });

    it('should call onReceiptReprint when receipt button is clicked', () => {
      const order = createMockOrder();
      render(<OrderCard order={order} onReceiptReprint={defaultOnReceiptReprint} />);

      fireEvent.click(screen.getByTestId('receipt-btn'));

      expect(defaultOnReceiptReprint).toHaveBeenCalledWith('order-1');
    });

    it('should not show receipt button when onReceiptReprint is not provided', () => {
      const order = createMockOrder();
      render(<OrderCard order={order} />);

      expect(screen.queryByTestId('receipt-btn')).toBeNull();
    });

    it('should show receipt button for cancelled orders', () => {
      const order = createMockOrder({ status: OrderStatus.Cancelled });
      render(<OrderCard order={order} onReceiptReprint={defaultOnReceiptReprint} />);

      expect(screen.getByTestId('receipt-btn')).toBeDefined();
    });
  });

  describe('Void action', () => {
    it('should show void button for Ordered status', () => {
      const order = createMockOrder({ status: OrderStatus.Ordered });
      render(<OrderCard order={order} onVoid={defaultOnVoid} />);

      expect(screen.getByTestId('void-btn')).toBeDefined();
    });

    it('should show void button for Paid status', () => {
      const order = createMockOrder({ status: OrderStatus.Paid });
      render(<OrderCard order={order} onVoid={defaultOnVoid} />);

      expect(screen.getByTestId('void-btn')).toBeDefined();
    });

    it('should not show void button for Cancelled status', () => {
      const order = createMockOrder({ status: OrderStatus.Cancelled });
      render(<OrderCard order={order} onVoid={defaultOnVoid} />);

      expect(screen.queryByTestId('void-btn')).toBeNull();
    });

    it('should call onVoid with order id when void is clicked', () => {
      const order = createMockOrder({ status: OrderStatus.Ordered });
      render(<OrderCard order={order} onVoid={defaultOnVoid} />);

      fireEvent.click(screen.getByTestId('void-btn'));

      expect(defaultOnVoid).toHaveBeenCalledWith('order-1');
    });
  });
});
