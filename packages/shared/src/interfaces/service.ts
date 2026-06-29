import { ServiceCategory } from '../enums';

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
  price: number;
  isActive: boolean;
  isMainService: boolean;
  sortOrder: number;
}

/**
 * Create/update service request body.
 */
export interface CreateServiceRequest {
  name: string;
  category: ServiceCategory;
  price: number;
  outletId?: string | null;
  isActive?: boolean;
  isMainService?: boolean;
  sortOrder?: number;
}

/**
 * Service query parameters.
 * GET /api/services
 */
export interface ServiceQueryParams {
  category?: ServiceCategory;
  outletId?: string;
  active?: boolean;
}
