/**
 * POS Orders page.
 * Displays all today's orders with search (order number, name, phone)
 * and status filter (All, Ordered, Paid, Confirmed, Completed, Cancelled).
 * Supports settling unpaid orders via Cash/QRIS and receipt reprint.
 *
 * Requirements: 20.2, 20.3, 20.4, 20.5, 20.6, 20.7
 */
'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { OrderStatus, PaymentMethod } from '@aire/shared/enums';
import type { OrderCard as OrderCardData } from '@aire/shared/interfaces/order';
import { OrderCard, PromoChipType } from '@/components/pos/OrderCard';

/** All status filter options including 'all' */
export type StatusFilter = 'all' | OrderStatus;

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: OrderStatus.Ordered, label: 'Ordered' },
  { value: OrderStatus.Paid, label: 'Paid' },
  { value: OrderStatus.Confirmed, label: 'Confirmed' },
  { value: OrderStatus.Completed, label: 'Completed' },
  { value: OrderStatus.Cancelled, label: 'Cancelled' },
];

export interface OrdersPageProps {
  /** Orders data (injected for testing; real app would fetch from API) */
  orders?: OrderCardData[];
  /** Promo chips map (orderId → chips) */
  promoChipsMap?: Record<string, PromoChipType[]>;
  /** Called when settling an unpaid order */
  onSettle?: (orderId: string, method: PaymentMethod.Cash | PaymentMethod.QrisStatic) => void;
  /** Called when reprinting a receipt */
  onReceiptReprint?: (orderId: string) => void;
  /** Called when voiding an order */
  onVoid?: (orderId: string) => void;
}

/**
 * Checks if a search query matches an order by order number, customer name, or phone.
 */
function matchesSearch(order: OrderCardData, query: string): boolean {
  if (!query) return true;
  const lowerQuery = query.toLowerCase();
  return (
    order.orderNumber.toLowerCase().includes(lowerQuery) ||
    order.customerName.toLowerCase().includes(lowerQuery) ||
    order.customerPhone.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Filters orders by status.
 */
function matchesStatus(order: OrderCardData, status: StatusFilter): boolean {
  if (status === 'all') return true;
  return order.status === status;
}

export default function OrdersPage({
  orders = [],
  promoChipsMap = {},
  onSettle,
  onReceiptReprint,
  onVoid,
}: OrdersPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const filteredOrders = useMemo(() => {
    return orders.filter(
      (order) => matchesSearch(order, searchQuery) && matchesStatus(order, statusFilter),
    );
  }, [orders, searchQuery, statusFilter]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  }, []);

  const handleStatusChange = useCallback((status: StatusFilter) => {
    setStatusFilter(status);
  }, []);

  return (
    <div className="orders-page" data-testid="orders-page">
      {/* Header */}
      <div className="orders-page__header">
        <h1>Orders</h1>
      </div>

      {/* Search bar */}
      <div className="orders-page__search">
        <input
          type="text"
          className="orders-page__search-input"
          placeholder="Search by order number, name, or phone..."
          value={searchQuery}
          onChange={handleSearchChange}
          aria-label="Search orders"
          data-testid="orders-search-input"
        />
      </div>

      {/* Status filter tabs */}
      <div
        className="orders-page__filters"
        role="tablist"
        aria-label="Filter orders by status"
        data-testid="orders-status-filters"
      >
        {STATUS_FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            role="tab"
            aria-selected={statusFilter === option.value}
            className={`orders-page__filter-tab ${
              statusFilter === option.value ? 'orders-page__filter-tab--active' : ''
            }`}
            onClick={() => handleStatusChange(option.value)}
            data-testid={`filter-tab-${option.value}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Orders list */}
      <div className="orders-page__list" data-testid="orders-list">
        {filteredOrders.length === 0 ? (
          <p className="orders-page__empty" data-testid="orders-empty">
            No orders found
          </p>
        ) : (
          filteredOrders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              promoChips={promoChipsMap[order.id]}
              onSettle={onSettle}
              onReceiptReprint={onReceiptReprint}
              onVoid={onVoid}
            />
          ))
        )}
      </div>

      {/* Result count */}
      <div className="orders-page__count" data-testid="orders-count">
        {filteredOrders.length} order{filteredOrders.length !== 1 ? 's' : ''} found
      </div>
    </div>
  );
}
