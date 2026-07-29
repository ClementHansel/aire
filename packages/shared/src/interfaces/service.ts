import { ServiceCategory, BusinessUnit } from '../enums';

/**
 * Service data transfer object.
 * GET /api/services
 */
export interface ServiceDTO {
  id: string;
  tenantId: string;
  /** Null means the service applies to all outlets */
  outletId: string | null;
  name: string;
  category: ServiceCategory;
  /** Business unit this service belongs to (AIRE car wash / LEAD detailing) */
  businessUnit: BusinessUnit;
  /** Optional product category reference */
  categoryId?: string | null;
  /** Optional brand reference */
  brandId?: string | null;
  /** Branches this product is available at. null/empty = all branches. */
  outletIds?: string[] | null;
  price: number;
  isActive: boolean;
  isMainService: boolean;
  sortOrder: number;
  /** Optional scan-to-cart barcode (unique per tenant). Null when unset. */
  barcode?: string | null;
  /** Per-item opt-in: whether a cashier may apply a manual discount at all (AIRIN-122/123). */
  dynamicDiscountEnabled?: boolean;
  /** Shape of the per-item discount cap. Null/absent when dynamicDiscountEnabled is false. */
  dynamicDiscountKind?: 'fixed' | 'percentage' | null;
  /** Per-item discount ceiling: Rupiah when kind='fixed', percent 0-100 when kind='percentage'. */
  maxDiscount?: number | null;
}

/**
 * Create/update service request body.
 */
export interface CreateServiceRequest {
  name: string;
  category: ServiceCategory;
  businessUnit?: BusinessUnit;
  categoryId?: string | null;
  brandId?: string | null;
  outletIds?: string[] | null;
  price: number;
  outletId?: string | null;
  isActive?: boolean;
  isMainService?: boolean;
  sortOrder?: number;
  /** Optional barcode. Empty string / null clears it. */
  barcode?: string | null;
  /** Per-item opt-in: whether a cashier may apply a manual discount at all (AIRIN-122/123). */
  dynamicDiscountEnabled?: boolean;
  /** Shape of the per-item discount cap. Required when dynamicDiscountEnabled is true. */
  dynamicDiscountKind?: 'fixed' | 'percentage' | null;
  /** Per-item discount ceiling: Rupiah when kind='fixed', percent 0-100 when kind='percentage'. */
  maxDiscount?: number | null;
}

/**
 * Service query parameters.
 * GET /api/services
 */
export interface ServiceQueryParams {
  category?: ServiceCategory;
  businessUnit?: BusinessUnit;
  outletId?: string;
  active?: boolean;
}
