import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JWTPayload } from '@aire/shared';

/**
 * Parameter decorator to extract the authenticated user (JWT payload) from the request.
 *
 * @example
 * @Get('profile')
 * getProfile(@CurrentUser() user: JWTPayload) {
 *   return { userId: user.sub, role: user.role };
 * }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JWTPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as JWTPayload;
  },
);
