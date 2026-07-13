import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

/** Identity attached to a request by PortalGuard. */
export interface PortalIdentity {
  customerId: string;
  tenantId: string;
}

interface PortalJwt {
  sub: string;
  tenant_id: string;
  typ: string;
}

/**
 * Authenticates a customer-portal request via the short-lived customer JWT
 * (issued by PortalAuthService after WhatsApp-OTP verification). Distinct from
 * the staff JwtAuthGuard: it requires `typ: 'customer'` so a staff token can't
 * reach portal routes and vice-versa.
 */
@Injectable()
export class PortalGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { portal?: PortalIdentity }>();
    const auth = req.headers['authorization'];
    const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) throw new UnauthorizedException('Missing portal token');
    let payload: PortalJwt;
    try {
      payload = this.jwt.verify<PortalJwt>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired portal token');
    }
    if (payload.typ !== 'customer' || !payload.sub || !payload.tenant_id) {
      throw new UnauthorizedException('Not a customer token');
    }
    req.portal = { customerId: payload.sub, tenantId: payload.tenant_id };
    return true;
  }
}

/** Injects the authenticated portal customer ({ customerId, tenantId }). */
export const PortalCtx = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PortalIdentity => {
    const req = context.switchToHttp().getRequest<Request & { portal?: PortalIdentity }>();
    if (!req.portal) throw new UnauthorizedException('No portal identity');
    return req.portal;
  },
);
