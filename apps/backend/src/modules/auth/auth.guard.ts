import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ERR_AUTH_TOKEN_EXPIRED, ERR_AUTH_TOKEN_INVALID } from '@aire/shared';

/**
 * JWT Authentication Guard.
 * Protects routes requiring a valid JWT access token.
 * Attach to controllers/routes via @UseGuards(JwtAuthGuard).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<T>(err: any, user: T, info: any, _context: ExecutionContext): T {
    if (err || !user) {
      if (info?.name === 'TokenExpiredError') {
        throw new UnauthorizedException(ERR_AUTH_TOKEN_EXPIRED);
      }
      throw new UnauthorizedException(ERR_AUTH_TOKEN_INVALID);
    }
    return user;
  }
}
