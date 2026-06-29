/**
 * Unit tests for OrdersPage component.
 * Requirements: 20.2, 20.3, 20.5, 20.6
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OrdersPage from './page';
import { OrderStatus, PaymentMethod } from '@aire/shared/enums';
import type { OrderCard as OrderCardData } from '@aire/shared/interfaces/order';

function createMockOrders(): OrderCardData[] {
  return [
    {
      id: 'order-1',
      orderNumber: 'ORD-001',
      customerName: 'Alice Smith',
      customerPhone: '6281234567890',
      vehicleBrand: 'Toyota',
      operatorName: 'Cashier A',
      status: OrderStatus.Ordered,
      items: [{ serviceName: 'Super Wash', quantity: 1, subtotal: 80000 }],
      total: 80000,
      createdAt: '2026-06-28T10:00:00Z',
    },
    {
      id: 'order-2',
      orderNumber: 'ORD-002',
      customerName: 'Bob Johnson',
      customerPhone: '6289876543210',
      vehicleBrand: 'Honda',
      operatorName: 'Cashier B',
      status: OrderStatus.Paid,
      items: [{ serviceName: 'Basic Wash', quantity: 2, subtotal: 60000 }],
      total: 60000,
      createdAt: '2026-06-28T11:00:00Z',
    },
    {
      id: 'order-3',
      orderNumber: 'ORD-003',
      customerName: 'Charlie Brown',
      customerPhone: '6281111222233',
      vehicleBrand: 'Suzuki',
      operatorName: 'Cashier A',
      status: OrderStatus.Completed,
      items: [{ serviceName: 'Premium Wash', quantity: 1, subtotal: 120000 }],
      total: 120000,
      createdAt: '2026-06-28T09:00:00Z',
    },
    {
      id: 'order-4',
      orderNumber: 'ORD-004',
      customerName: 'Diana Prince',
      customerPhone: '6284444555566',
      vehicleBrand: 'BMW',
      operatorName: 'Cashier B',
      status: OrderStatus.Cancelled,
      items: [{ serviceName: 'Super Wash', quantity: 1, subtotal: 80000 }],
      total: 80000,
      createdAt: '2026-06-28T08:00:00Z',
    },
  ];
}

describe('OrdersPage', () => {
  describe('Requirement 20.2: Orders list with search and filter', () => {
    it('should render the orders page', () => {
      render(<OrdersPage orders={createMockOrders()} />);
      expect(screen.getByTestId('orders-page')).toBeDefined();
    });

    it('should display all orders when no filter is applied', () => {
      render(<OrdersPage orders={createMockOrders()} />);
      expect(screen.getByTestId('orders-count').textContent).toContain('4 orders');
    });

    it('should display search input', () => {
      render(<OrdersPage orders={createMockOrders()} />);
      expect(screen.getByTestId('orders-search-input')).toBeDefined();
    });

    it('should display status filter tabs', () => {
      render(<OrdersPage orders={createMockOrders()} />);
      expect(screen.getByTestId('orders-status-filters')).toBeDefined();
      expect(screen.getByTestId('filter-tab-all')).toBeDefined();
      expect(screen.getByTestId('filter-tab-ordered')).toBeDefined();
      expect(screen.getByTestId('filter-tab-paid')).toBeDefined();
      expect(screen.getByTestId('filter-tab-confirmed')).toBeDefined();
      expect(screen.getByTestId('filter-tab-completed')).toBeDefined();
      expect(screen.getByTestId('filter-tab-cancelled')).toBeDefined();
    });

    it('should filter by order number search', () => {
      render(<OrdersPage orders={createMockOrders()} />);

      const searchInput = screen.getByTestId('orders-search-input');
      fireEvent.change(searchInput, { target: { value: 'ORD-001' } });

      expect(screen.getByTestId('orders-count').textContent).toContain('1 order');
      expect(screen.getByTestId('order-card-order-1')).toBeDefined();
    });

    it('should filter by customer name search', () => {
      render(<OrdersPage orders={createMockOrders()} />);

      const searchInput = screen.getByTestId('orders-search-input');
      fireEvent.change(searchInput, { target: { value: 'Alice' } });

      expect(screen.getByTestId('orders-count').textContent).toContain('1 order');
      expect(screen.getByTestId('order-card-order-1')).toBeDefined();
    });

    it('should filter by phone number search', () => {
      render(<OrdersPage orders={createMockOrders()} />);

      const searchInput = screen.getByTestId('orders-search-input');
      fireEvent.change(searchInput, { target: { value: '9876543210' } });

      expect(screen.getByTestId('orders-count').textContent).toContain('1 order');
      expect(screen.getByTestId('order-card-order-2')).toBeDefined();
    });

    it('should filter by status when tab is selected', () => {
      render(<OrdersPage orders={createMockOrders()} />);

      fireEvent.click(screen.getByTestId('filter-tab-ordered'));

      expect(screen.getByTestId('orders-count').textContent).toContain('1 order');
      expect(screen.getByTestId('order-card-order-1')).toBeDefined();
    });

    it('should filter by Paid status', () => {
      render(<OrdersPage orders={createMockOrders()} />);

      fireEvent.click(screen.getByTestId('filter-tab-paid'));

      expect(screen.getByTestId('orders-count').textContent).toContain('1 order');
      expect(screen.getByTestId('order-card-order-2')).toBeDefined();
    });

    it('should show all orders when All tab is selected', () => {
      render(<OrdersPage orders={createMockOrders()} />);

      fireEvent.click(screen.getByTestId('filter-tab-ordered'));
      expect(screen.getByTestId('orders-count').textContent).toContain('1 order');

      fireEvent.click(screen.getByTestId('filter-tab-all'));
      expect(screen.getByTestId('orders-count').textContent).toContain('4 orders');
    });

    it('should combine search and status filter', () => {
      const orders = createMockOrders();
      render(<OrdersPage orders={orders} />);

      // Filter by Ordered status
      fireEvent.click(screen.getByTestId('filter-tab-ordered'));
      // Then search by name
      const searchInput = screen.getByTestId('orders-search-input');
      fireEvent.change(searchInput, { target: { value: 'Alice' } });

      expect(screen.getByTestId('orders-count').textContent).toContain('1 order');
      expect(screen.getByTestId('order-card-order-1')).toBeDefined();
    });

    it('should show empty state when no orders match', () => {
      render(<OrdersPage orders={createMockOrders()} />);

      const searchInput = screen.getByTestId('orders-search-input');
      fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

      expect(screen.getByTestId('orders-empty')).toBeDefined();
      expect(screen.getByTestId('orders-count').textContent).toContain('0 orders');
    });

    it('should be case-insensitive in search', () => {
      render(<OrdersPage orders={createMockOrders()} />);

      const searchInput = screen.getByTestId('orders-search-input');
      fireEvent.change(searchInput, { target: { value: 'alice' } });

      expect(screen.getByTestId('orders-count').textContent).toContain('1 order');
    });
  });

  describe('Requirement 20.6: Settle unpaid orders', () => {
    it('should pass onSettle to order cards', () => {
      const onSettle = vi.fn();
      render(<OrdersPage orders={createMockOrders()} onSettle={onSettle} />);

      // Order-1 is Ordered (unpaid) - should have settle button
      const settleBtn = screen.getByTestId('settle-btn');
      fireEvent.click(settleBtn);
      fireEvent.click(screen.getByTestId('settle-cash-btn'));

      expect(onSettle).toHaveBeenCalledWith('order-1', PaymentMethod.Cash);
    });
  });

  describe('Requirement 20.7: Receipt reprint', () => {
    it('should pass onReceiptReprint to order cards', () => {
      const onReceiptReprint = vi.fn();
      render(<OrdersPage orders={createMockOrders()} onReceiptReprint={onReceiptReprint} />);

      // All order cards should have receipt buttons
      const receiptBtns = screen.getAllByTestId('receipt-btn');
      expect(receiptBtns.length).toBe(4);

      fireEvent.click(receiptBtns[0]);
      expect(onReceiptReprint).toHaveBeenCalledWith('order-1');
    });
  });

  describe('Empty state', () => {
    it('should show empty state when no orders are provided', () => {
      render(<OrdersPage orders={[]} />);

      expect(screen.getByTestId('orders-empty')).toBeDefined();
      expect(screen.getByTestId('orders-count').textContent).toContain('0 orders');
    });
  });

  describe('Promo chips', () => {
    it('should pass promo chips to order cards', () => {
      const promoChipsMap = {
        'order-1': ['member' as const, 'voucher' as const],
      };
      render(<OrdersPage orders={createMockOrders()} promoChipsMap={promoChipsMap} />);

      expect(screen.getByTestId('promo-chip-member')).toBeDefined();
      expect(screen.getByTestId('promo-chip-voucher')).toBeDefined();
    });
  });
});
