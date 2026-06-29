/**
 * POS Sell Pack page.
 * Allows cashiers to sell membership plans and voucher packs.
 * Provides tab navigation between Membership Plans and Voucher Packs,
 * add-to-cart functionality, and post-payment vehicle registration for memberships.
 *
 * Requirements: 14.1, 14.2, 14.4, 18.1
 */
'use client';

import React, { useState, useCallback } from 'react';

// --- Types ---

export interface MembershipPlanCard {
  id: string;
  name: string;
  price: number;
  durationMonths: number;
  maxUses: number;
  dailyLimit: number;
  maxPlates: number;
  freeServices: string[];
  discountedServices: Array<{ serviceId: string; serviceName: string; discountPct: number }>;
}

export interface VoucherPackCard {
  id: string;
  name: string;
  price: number;
  type: 'fixed' | 'percentage' | 'service_pack';
  value: number;
  totalUses: number;
  services: string[];
  validityDays: number;
}

export interface VehicleRegistration {
  plate: string;
  brand: string;
  model: string;
}

export interface SellPackCartItem {
  type: 'membership' | 'voucher_pack';
  id: string;
  name: string;
  price: number;
  details: string;
}

export type SellPackTab = 'membership' | 'voucher';

// --- Sub-Components ---

interface PlanCardProps {
  plan: MembershipPlanCard;
  onAddToCart: (plan: MembershipPlanCard) => void;
  disabled: boolean;
}

function PlanCard({ plan, onAddToCart, disabled }: PlanCardProps) {
  return (
    <div className="sell-pack__card" data-testid={`plan-card-${plan.id}`}>
      <div className="sell-pack__card-header">
        <h3 className="sell-pack__card-name">{plan.name}</h3>
        <span className="sell-pack__card-price" data-testid={`plan-price-${plan.id}`}>
          Rp {plan.price.toLocaleString()}
        </span>
      </div>
      <div className="sell-pack__card-details">
        <p>{plan.durationMonths} month{plan.durationMonths > 1 ? 's' : ''}</p>
        <p>{plan.maxUses} washes, {plan.dailyLimit}/day limit</p>
        <p>Max {plan.maxPlates} plate{plan.maxPlates > 1 ? 's' : ''}</p>
        {plan.freeServices.length > 0 && (
          <p className="sell-pack__card-free">Free: {plan.freeServices.join(', ')}</p>
        )}
        {plan.discountedServices.length > 0 && (
          <p className="sell-pack__card-discount">
            Discounted: {plan.discountedServices.map((s) => `${s.serviceName} (${s.discountPct}%)`).join(', ')}
          </p>
        )}
      </div>
      <button
        className="sell-pack__add-btn"
        onClick={() => onAddToCart(plan)}
        disabled={disabled}
        aria-label={`Add ${plan.name} to cart`}
        data-testid={`add-plan-${plan.id}`}
      >
        {disabled ? 'Max 1 plan per order' : 'Add to Cart'}
      </button>
    </div>
  );
}

interface VoucherPackCardComponentProps {
  pack: VoucherPackCard;
  onAddToCart: (pack: VoucherPackCard) => void;
}

function VoucherPackCardComponent({ pack, onAddToCart }: VoucherPackCardComponentProps) {
  return (
    <div className="sell-pack__card" data-testid={`pack-card-${pack.id}`}>
      <div className="sell-pack__card-header">
        <h3 className="sell-pack__card-name">{pack.name}</h3>
        <span className="sell-pack__card-price" data-testid={`pack-price-${pack.id}`}>
          Rp {pack.price.toLocaleString()}
        </span>
      </div>
      <div className="sell-pack__card-details">
        <p>{pack.totalUses} use{pack.totalUses > 1 ? 's' : ''}</p>
        <p>Valid for {pack.validityDays} days</p>
        {pack.services.length > 0 && (
          <p>Services: {pack.services.join(', ')}</p>
        )}
        <p className="sell-pack__card-type">Type: {pack.type.replace('_', ' ')}</p>
      </div>
      <button
        className="sell-pack__add-btn"
        onClick={() => onAddToCart(pack)}
        aria-label={`Add ${pack.name} to cart`}
        data-testid={`add-pack-${pack.id}`}
      >
        Add to Cart
      </button>
    </div>
  );
}

interface VehicleRegistrationDialogProps {
  maxPlates: number;
  prefillPlate?: string;
  prefillBrand?: string;
  prefillModel?: string;
  onSave: (vehicles: VehicleRegistration[]) => void;
  onClose: () => void;
}

export function VehicleRegistrationDialog({
  maxPlates,
  prefillPlate,
  prefillBrand,
  prefillModel,
  onSave,
  onClose,
}: VehicleRegistrationDialogProps) {
  const [vehicles, setVehicles] = useState<VehicleRegistration[]>([
    {
      plate: prefillPlate || '',
      brand: prefillBrand || '',
      model: prefillModel || '',
    },
  ]);

  const handleVehicleChange = useCallback(
    (index: number, field: keyof VehicleRegistration, value: string) => {
      setVehicles((prev) => {
        const updated = [...prev];
        updated[index] = { ...updated[index], [field]: value } as VehicleRegistration;
        return updated;
      });
    },
    [],
  );

  const handleAddVehicle = useCallback(() => {
    if (vehicles.length < maxPlates) {
      setVehicles((prev) => [...prev, { plate: '', brand: '', model: '' }]);
    }
  }, [vehicles.length, maxPlates]);

  const handleRemoveVehicle = useCallback((index: number) => {
    setVehicles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSave = useCallback(() => {
    const validVehicles = vehicles.filter((v) => v.plate.trim() !== '');
    if (validVehicles.length > 0) {
      onSave(validVehicles);
    }
  }, [vehicles, onSave]);

  const hasValidPlate = vehicles.some((v) => v.plate.trim() !== '');

  return (
    <div
      className="sell-pack__vehicle-dialog-overlay"
      role="dialog"
      aria-label="Vehicle registration"
      aria-modal="true"
      data-testid="vehicle-registration-dialog"
    >
      <div className="sell-pack__vehicle-dialog">
        <div className="sell-pack__vehicle-dialog-header">
          <h2>Register Vehicles</h2>
          <p>Register up to {maxPlates} vehicle plate{maxPlates > 1 ? 's' : ''} for this membership.</p>
        </div>

        <div className="sell-pack__vehicle-list" data-testid="vehicle-list">
          {vehicles.map((vehicle, index) => (
            <div
              key={index}
              className="sell-pack__vehicle-entry"
              data-testid={`vehicle-entry-${index}`}
            >
              <div className="sell-pack__vehicle-fields">
                <input
                  type="text"
                  placeholder="License Plate"
                  value={vehicle.plate}
                  onChange={(e) => handleVehicleChange(index, 'plate', e.target.value)}
                  aria-label={`Vehicle ${index + 1} license plate`}
                  data-testid={`vehicle-plate-${index}`}
                />
                <input
                  type="text"
                  placeholder="Brand"
                  value={vehicle.brand}
                  onChange={(e) => handleVehicleChange(index, 'brand', e.target.value)}
                  aria-label={`Vehicle ${index + 1} brand`}
                  data-testid={`vehicle-brand-${index}`}
                />
                <input
                  type="text"
                  placeholder="Model"
                  value={vehicle.model}
                  onChange={(e) => handleVehicleChange(index, 'model', e.target.value)}
                  aria-label={`Vehicle ${index + 1} model`}
                  data-testid={`vehicle-model-${index}`}
                />
              </div>
              {vehicles.length > 1 && (
                <button
                  className="sell-pack__vehicle-remove"
                  onClick={() => handleRemoveVehicle(index)}
                  aria-label={`Remove vehicle ${index + 1}`}
                  data-testid={`remove-vehicle-${index}`}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        {vehicles.length < maxPlates && (
          <button
            className="sell-pack__add-vehicle-btn"
            onClick={handleAddVehicle}
            aria-label="Add another vehicle"
            data-testid="add-vehicle-btn"
          >
            + Add Vehicle
          </button>
        )}

        <div className="sell-pack__vehicle-dialog-actions">
          <button
            className="sell-pack__cancel-btn"
            onClick={onClose}
            data-testid="vehicle-cancel-btn"
          >
            Cancel
          </button>
          <button
            className="sell-pack__save-btn"
            onClick={handleSave}
            disabled={!hasValidPlate}
            aria-label="Save vehicle registration"
            data-testid="vehicle-save-btn"
          >
            Save & Activate
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Main Page Component ---

export interface SellPackPageProps {
  membershipPlans?: MembershipPlanCard[];
  voucherPacks?: VoucherPackCard[];
  prefillPlate?: string;
  prefillBrand?: string;
  prefillModel?: string;
}

export default function SellPackPage({
  membershipPlans = [],
  voucherPacks = [],
  prefillPlate,
  prefillBrand,
  prefillModel,
}: SellPackPageProps) {
  const [activeTab, setActiveTab] = useState<SellPackTab>('membership');
  const [cartItem, setCartItem] = useState<SellPackCartItem | null>(null);
  const [showVehicleRegistration, setShowVehicleRegistration] = useState(false);
  const [selectedPlanMaxPlates, setSelectedPlanMaxPlates] = useState(3);

  // Requirement 14.2: Enforce max one membership plan per order
  const hasMembershipInCart = cartItem?.type === 'membership';

  const handleAddMembershipToCart = useCallback(
    (plan: MembershipPlanCard) => {
      // Requirement 14.2: max one Membership_Plan per order
      if (hasMembershipInCart) return;

      const details = `${plan.durationMonths}mo, ${plan.maxUses} washes, ${plan.dailyLimit}/day`;
      setCartItem({
        type: 'membership',
        id: plan.id,
        name: plan.name,
        price: plan.price,
        details,
      });
      setSelectedPlanMaxPlates(plan.maxPlates);
    },
    [hasMembershipInCart],
  );

  const handleAddVoucherPackToCart = useCallback((pack: VoucherPackCard) => {
    const details = `${pack.totalUses} uses, ${pack.validityDays} days validity`;
    setCartItem({
      type: 'voucher_pack',
      id: pack.id,
      name: pack.name,
      price: pack.price,
      details,
    });
  }, []);

  const handleRemoveFromCart = useCallback(() => {
    setCartItem(null);
  }, []);

  const handlePaymentConfirmed = useCallback(() => {
    // Requirement 14.4: After membership payment is confirmed, open vehicle registration
    if (cartItem?.type === 'membership') {
      setShowVehicleRegistration(true);
    }
    // For voucher packs, the backend handles code generation (Req 18.2)
  }, [cartItem]);

  const handleVehicleRegistrationSave = useCallback((_vehicles: VehicleRegistration[]) => {
    // TODO: POST /api/memberships/sell with vehicle data
    setShowVehicleRegistration(false);
    setCartItem(null);
  }, []);

  const handleVehicleRegistrationClose = useCallback(() => {
    setShowVehicleRegistration(false);
  }, []);

  return (
    <div className="sell-pack-page" data-testid="sell-pack-page">
      <div className="sell-pack-page__header">
        <h1>Sell Pack</h1>
      </div>

      {/* Tab Navigation */}
      <div className="sell-pack-page__tabs" role="tablist" aria-label="Pack type selection">
        <button
          role="tab"
          aria-selected={activeTab === 'membership'}
          aria-controls="membership-panel"
          className={`sell-pack-page__tab ${activeTab === 'membership' ? 'sell-pack-page__tab--active' : ''}`}
          onClick={() => setActiveTab('membership')}
          data-testid="tab-membership"
        >
          Membership Plans
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'voucher'}
          aria-controls="voucher-panel"
          className={`sell-pack-page__tab ${activeTab === 'voucher' ? 'sell-pack-page__tab--active' : ''}`}
          onClick={() => setActiveTab('voucher')}
          data-testid="tab-voucher"
        >
          Voucher Packs
        </button>
      </div>

      <div className="sell-pack-page__content">
        {/* Tab Panels */}
        <div className="sell-pack-page__panel">
          {activeTab === 'membership' && (
            <div
              id="membership-panel"
              role="tabpanel"
              aria-label="Membership Plans"
              data-testid="membership-panel"
            >
              {membershipPlans.length === 0 ? (
                <p className="sell-pack-page__empty" data-testid="no-membership-plans">
                  No membership plans available
                </p>
              ) : (
                <div className="sell-pack-page__grid">
                  {membershipPlans.map((plan) => (
                    <PlanCard
                      key={plan.id}
                      plan={plan}
                      onAddToCart={handleAddMembershipToCart}
                      disabled={hasMembershipInCart}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'voucher' && (
            <div
              id="voucher-panel"
              role="tabpanel"
              aria-label="Voucher Packs"
              data-testid="voucher-panel"
            >
              {voucherPacks.length === 0 ? (
                <p className="sell-pack-page__empty" data-testid="no-voucher-packs">
                  No voucher packs available
                </p>
              ) : (
                <div className="sell-pack-page__grid">
                  {voucherPacks.map((pack) => (
                    <VoucherPackCardComponent
                      key={pack.id}
                      pack={pack}
                      onAddToCart={handleAddVoucherPackToCart}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Cart Summary Sidebar */}
        <div className="sell-pack-page__cart" data-testid="sell-pack-cart">
          <h2>Cart</h2>
          {cartItem === null ? (
            <p className="sell-pack-page__cart-empty" data-testid="sell-pack-cart-empty">
              No pack selected
            </p>
          ) : (
            <div className="sell-pack-page__cart-item" data-testid="sell-pack-cart-item">
              <div className="sell-pack-page__cart-item-info">
                <span className="sell-pack-page__cart-item-name" data-testid="cart-item-name">
                  {cartItem.name}
                </span>
                <span className="sell-pack-page__cart-item-type" data-testid="cart-item-type">
                  {cartItem.type === 'membership' ? 'Membership Plan' : 'Voucher Pack'}
                </span>
                <span className="sell-pack-page__cart-item-details" data-testid="cart-item-details">
                  {cartItem.details}
                </span>
              </div>
              <div className="sell-pack-page__cart-item-price" data-testid="cart-item-price">
                Rp {cartItem.price.toLocaleString()}
              </div>
              <button
                className="sell-pack-page__cart-remove"
                onClick={handleRemoveFromCart}
                aria-label="Remove from cart"
                data-testid="cart-remove-btn"
              >
                ✕
              </button>
            </div>
          )}

          {cartItem !== null && (
            <div className="sell-pack-page__cart-total">
              <span>Total</span>
              <span data-testid="cart-total">Rp {cartItem.price.toLocaleString()}</span>
            </div>
          )}

          {cartItem !== null && (
            <button
              className="sell-pack-page__pay-btn"
              onClick={handlePaymentConfirmed}
              aria-label="Proceed to payment"
              data-testid="proceed-payment-btn"
            >
              Proceed to Payment
            </button>
          )}
        </div>
      </div>

      {/* Vehicle Registration Dialog (post-payment for memberships) */}
      {showVehicleRegistration && (
        <VehicleRegistrationDialog
          maxPlates={selectedPlanMaxPlates}
          prefillPlate={prefillPlate}
          prefillBrand={prefillBrand}
          prefillModel={prefillModel}
          onSave={handleVehicleRegistrationSave}
          onClose={handleVehicleRegistrationClose}
        />
      )}
    </div>
  );
}
