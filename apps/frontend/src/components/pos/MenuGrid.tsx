/**
 * MenuGrid component for POS new order flow.
 * Displays service catalog with category tabs and service tiles.
 *
 * Requirements: 6.1, 6.2, 6.3
 */
'use client';

import React, { useMemo, useState } from 'react';
import { ServiceCategory } from '@aire/shared/enums';
import { useCartStore } from '@/stores/cartStore';

export interface ServiceTile {
  id: string;
  name: string;
  price: number;
  category: ServiceCategory;
  isActive: boolean;
  isMainService: boolean;
  /** Whether this service is free for the current member */
  isMemberFree?: boolean;
  /** Discount percentage for members (e.g., 20 for 20%) */
  memberDiscountPct?: number;
}

export type CategoryTab = 'all' | ServiceCategory;

const CATEGORY_LABELS: Record<CategoryTab, string> = {
  all: 'All',
  [ServiceCategory.CarWash]: 'Car Wash',
  [ServiceCategory.Product]: 'Product',
  [ServiceCategory.AddOn]: 'Add-on',
};

const CATEGORY_ORDER: CategoryTab[] = [
  'all',
  ServiceCategory.CarWash,
  ServiceCategory.Product,
  ServiceCategory.AddOn,
];

export interface MenuGridProps {
  services: ServiceTile[];
}

export function MenuGrid({ services }: MenuGridProps) {
  const [activeTab, setActiveTab] = useState<CategoryTab>('all');
  const { items, addItem } = useCartStore();

  const categoryCounts = useMemo(() => {
    const counts: Record<CategoryTab, number> = {
      all: services.length,
      [ServiceCategory.CarWash]: 0,
      [ServiceCategory.Product]: 0,
      [ServiceCategory.AddOn]: 0,
    };

    for (const service of services) {
      counts[service.category] = (counts[service.category] || 0) + 1;
    }

    return counts;
  }, [services]);

  const filteredServices = useMemo(() => {
    if (activeTab === 'all') return services;
    return services.filter((s) => s.category === activeTab);
  }, [services, activeTab]);

  const cartQuantityMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of items) {
      map[item.serviceId] = item.quantity;
    }
    return map;
  }, [items]);

  const handleTileClick = (service: ServiceTile) => {
    if (!service.isActive) return;

    addItem({
      serviceId: service.id,
      serviceName: service.name,
      quantity: 1,
      unitPrice: service.price,
      discount: 0,
      isMainService: service.isMainService,
    });
  };

  return (
    <div className="menu-grid" data-testid="menu-grid">
      {/* Category Tabs */}
      <div className="menu-grid__tabs" role="tablist" aria-label="Service categories">
        {CATEGORY_ORDER.map((category) => (
          <button
            key={category}
            role="tab"
            aria-selected={activeTab === category}
            aria-controls={`panel-${category}`}
            className={`menu-grid__tab ${activeTab === category ? 'menu-grid__tab--active' : ''}`}
            onClick={() => setActiveTab(category)}
            data-testid={`tab-${category}`}
          >
            {CATEGORY_LABELS[category]}
            <span className="menu-grid__tab-badge" aria-label={`${categoryCounts[category]} items`}>
              {categoryCounts[category]}
            </span>
          </button>
        ))}
      </div>

      {/* Service Tiles Grid */}
      <div
        className="menu-grid__tiles"
        role="tabpanel"
        id={`panel-${activeTab}`}
        aria-label={`${CATEGORY_LABELS[activeTab]} services`}
        data-testid="service-tiles"
      >
        {filteredServices.map((service) => {
          const quantityInCart = cartQuantityMap[service.id] || 0;
          const isDisabled = !service.isActive;

          return (
            <button
              key={service.id}
              className={`menu-grid__tile ${isDisabled ? 'menu-grid__tile--disabled' : ''}`}
              onClick={() => handleTileClick(service)}
              disabled={isDisabled}
              aria-label={`${service.name}, Rp ${service.price.toLocaleString()}${isDisabled ? ', sold out' : ''}`}
              data-testid={`tile-${service.id}`}
            >
              <span className="menu-grid__tile-name">{service.name}</span>
              <span className="menu-grid__tile-price">
                Rp {service.price.toLocaleString()}
              </span>

              {/* Badges */}
              <div className="menu-grid__tile-badges">
                {service.isMemberFree && (
                  <span className="menu-grid__badge menu-grid__badge--gratis" data-testid={`badge-gratis-${service.id}`}>
                    GRATIS
                  </span>
                )}
                {!service.isMemberFree && service.memberDiscountPct && service.memberDiscountPct > 0 && (
                  <span className="menu-grid__badge menu-grid__badge--discount" data-testid={`badge-discount-${service.id}`}>
                    -{service.memberDiscountPct}%
                  </span>
                )}
                {isDisabled && (
                  <span className="menu-grid__badge menu-grid__badge--habis" data-testid={`badge-habis-${service.id}`}>
                    Habis
                  </span>
                )}
                {quantityInCart > 0 && (
                  <span className="menu-grid__badge menu-grid__badge--quantity" data-testid={`badge-qty-${service.id}`}>
                    {quantityInCart}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
