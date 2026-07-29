import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { ResolvedBridge } from '../bridge';

/**
 * Extract the resolved bridge context (tenantId/outletId/bridgeId) attached by
 * {@link LprBridgeGuard}. Mirrors agent-bridge's `BridgeCtx` decorator.
 *
 * @example
 * @Post()
 * @UseGuards(LprBridgeGuard)
 * ingest(@LprBridgeCtx() bridge: ResolvedBridge, @Body() body: PlateDetectionInput) { ... }
 */
export const LprBridgeCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ResolvedBridge => {
    const req = ctx.switchToHttp().getRequest();
    return req.bridge as ResolvedBridge;
  },
);
