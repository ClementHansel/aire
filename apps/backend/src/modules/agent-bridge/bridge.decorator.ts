import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { BridgeContext } from './bridge-token.guard';

/**
 * Extract the bridge context (resolved tenantId) set by BridgeTokenGuard.
 *
 * @example
 * @Post('llm')
 * llm(@BridgeCtx() ctx: BridgeContext, @Body() body: LlmDto) { ... }
 */
export const BridgeCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): BridgeContext => {
    const req = ctx.switchToHttp().getRequest();
    return req.bridge as BridgeContext;
  },
);
