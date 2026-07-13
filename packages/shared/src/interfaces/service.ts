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
