import { Role } from '../enums';

/**
 * JWT token payload claims structure.
 * Issued upon successful authentication.
 */
export interface JWTPayload {
  /** User ID (subject claim) */
  sub: string;
  /** Tenant ID for data isolation */
  tenant_id: string;
  /** Outlet ID — null for Platform_Super_Admin and Tenant_Owner */
  outlet_id: string | null;
  /** User role determining access level */
  role: 'platform_super_admin' | 'tenant_owner' | 'outlet_admin' | 'cashier';
  /** Issued at timestamp (seconds since epoch) */
  iat: number;
  /** Expiration timestamp (seconds since epoch) */
  exp: number;
}

/**
 * Login endpoint request body.
 * POST /api/auth/login
 */
export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Login endpoint response.
 * POST /api/auth/login
 */
export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    name: string;
    role: Role;
    tenantId: string;
    outletId?: string;
  };
}

/**
 * Token refresh request body.
 * POST /api/auth/refresh
 */
export interface RefreshRequest {
  refreshToken: string;
}

/**
 * Token refresh response.
 * POST /api/auth/refresh
 */
export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}
