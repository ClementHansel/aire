/**
 * MemberBanner component for POS new order flow.
 * Displays membership status, plan name, expiry, plates, and available benefits.
 *
 * Requirements: 6.6, 12.3, 12.4, 12.5
 */
'use client';

import React from 'react';
import { MembershipDetail } from '@aire/shared/interfaces/member';
import { MembershipStatus } from '@aire/shared/enums';

export interface MemberBannerProps {
  /** Active memberships for the customer */
  memberships: MembershipDetail[];
  /** All service names available (for displaying free/discounted service names) */
  serviceNames?: Record<string, string>;
}

/**
 * Displays a membership banner for each active membership.
 * Shows plan name, expiry date, registered plates, free services, and discounted services.
 */
export function MemberBanner({ memberships, serviceNames = {} }: MemberBannerProps) {
  const activeMemberships = memberships.filter(
    (m) => m.status === MembershipStatus.Active,
  );

  if (activeMemberships.length === 0) {
    return null;
  }

  return (
    <div className="member-banner" data-testid="member-banner">
      {activeMemberships.map((membership) => (
        <div
          key={membership.id}
          className="member-banner__card"
          data-testid={`member-banner-card-${membership.id}`}
        >
          {/* Plan name and status */}
          <div className="member-banner__header">
            <span
              className="member-banner__plan-name"
              data-testid={`plan-name-${membership.id}`}
            >
              {membership.planName}
            </span>
            <span
              className="member-banner__status member-banner__status--active"
              data-testid={`plan-status-${membership.id}`}
            >
              Active
            </span>
          </div>

          {/* Expiry date */}
          <div className="member-banner__expiry">
            <span className="member-banner__label">Expires:</span>
            <span data-testid={`plan-expiry-${membership.id}`}>
              {formatDate(membership.endDate)}
            </span>
          </div>

          {/* Quota usage */}
          <div className="member-banner__quota">
            <span className="member-banner__label">Usage:</span>
            <span data-testid={`plan-quota-${membership.id}`}>
              {membership.usesCount} / {membership.maxUses}
            </span>
          </div>

          {/* Registered plates */}
          {membership.plates.length > 0 && (
            <div className="member-banner__plates">
              <span className="member-banner__label">Plates:</span>
              <div
                className="member-banner__plate-list"
                data-testid={`plan-plates-${membership.id}`}
              >
                {membership.plates.map((p) => (
                  <span
                    key={p.plate}
                    className="member-banner__plate-chip"
                    data-testid={`plate-chip-${p.plate}`}
                  >
                    {p.plate}
                    {p.brand && ` (${p.brand}${p.model ? ` ${p.model}` : ''})`}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Free services */}
          {membership.freeServices.length > 0 && (
            <div className="member-banner__services">
              <span className="member-banner__label">Free services:</span>
              <div
                className="member-banner__service-list"
                data-testid={`plan-free-services-${membership.id}`}
              >
                {membership.freeServices.map((serviceId) => (
                  <span
                    key={serviceId}
                    className="member-banner__service-chip member-banner__service-chip--free"
                    data-testid={`free-service-${serviceId}`}
                  >
                    {serviceNames[serviceId] || serviceId}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Discounted services */}
          {membership.discountedServices.length > 0 && (
            <div className="member-banner__services">
              <span className="member-banner__label">Discounted services:</span>
              <div
                className="member-banner__service-list"
                data-testid={`plan-discounted-services-${membership.id}`}
              >
                {membership.discountedServices.map((ds) => (
                  <span
                    key={ds.serviceId}
                    className="member-banner__service-chip member-banner__service-chip--discount"
                    data-testid={`discount-service-${ds.serviceId}`}
                  >
                    {serviceNames[ds.serviceId] || ds.serviceId}{' '}
                    {ds.fixedPrice != null
                      ? `(Rp ${ds.fixedPrice.toLocaleString('id-ID')})`
                      : `(-${ds.discountPct}%)`}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Daily usage warning */}
          {hasDailyLimitReached(membership) && (
            <div
              className="member-banner__warning"
              role="alert"
              data-testid={`daily-limit-warning-${membership.id}`}
            >
              ⚠️ Daily limit reached for one or more plates. Normal pricing applies.
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Formats an ISO date string to a human-readable format.
 */
function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/**
 * Checks if any plate in the membership has reached its daily usage limit.
 */
function hasDailyLimitReached(membership: MembershipDetail): boolean {
  for (const plate of membership.plates) {
    const usage = membership.dailyUsageToday[plate.plate] ?? 0;
    if (usage >= membership.dailyLimit) {
      return true;
    }
  }
  return false;
}
