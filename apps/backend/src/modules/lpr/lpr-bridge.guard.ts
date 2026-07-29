import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { BridgeService, ResolvedBridge } from '../bridge';

/**
 * LprBridgeGuard — machine-to-machine auth for the on-prem branch bridge.
 *
 * The ANPR camera/NVR does its own recognition and hands the reading to the
 * branch bridge, which forwards it to POST /api/lpr/detections. The bridge is
 * not a logged-in user (no JWT), so this reuses the SAME opaque
 * `pairing_token` model as {@link BridgeGateway}'s socket handshake
 * (`BridgeService.resolveByToken`) rather than inventing a second auth scheme:
 * one bridge, one pairing token, presented here over HTTP as
 * `X-Aire-Bridge-Token` (mirroring the header convention BridgeTokenGuard uses
 * for the n8n bridge in agent-bridge/).
 *
 * Resolving the token also resolves tenantId + outletId server-side — the
 * request body's outletId is never trusted as scope, only cross-checked
 * against it (see LprController.ingest).
 */
@Injectable()
export class LprBridgeGuard implements CanActivate {
  constructor(private readonly bridgeService: BridgeService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header = req.headers['x-aire-bridge-token'];
    const token: string | undefined =
      (Array.isArray(header) ? header[0] : header) || req.query?.bridgeToken;

    if (!token || typeof token !== 'string' || token.trim() === '') {
      throw new UnauthorizedException('Missing bridge token');
    }

    const resolved = await this.bridgeService.resolveByToken(token.trim());
    if (!resolved) {
      throw new UnauthorizedException('Invalid bridge token');
    }

    (req as { bridge?: ResolvedBridge }).bridge = resolved;
    return true;
  }
}
