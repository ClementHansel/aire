import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JWTPayload, ERR_AUTH_TOKEN_INVALID } from '@aire/shared';

/**
 * StreamAuthGuard — JWT auth for HLS media endpoints.
 *
 * `<video>` / hls.js request `.m3u8` playlists and `.ts` segments as plain
 * media URLs, and native players (Safari) cannot attach an `Authorization`
 * header to those sub-requests. So, unlike the normal {@link JwtAuthGuard},
 * this guard accepts the access token EITHER from the `Authorization: Bearer`
 * header OR from an `?access_token=` query parameter, verifying it against the
 * same `JWT_SECRET` the passport-jwt strategy uses. The decoded payload is
 * attached to `request.user` exactly like JwtAuthGuard.
 */
@Injectable()
export class StreamAuthGuard implements CanActivate {
  private readonly secret: string;

  constructor(
    private readonly jwtService: JwtService,
    configService: ConfigService,
  ) {
    this.secret = configService.get<string>('JWT_SECRET', 'aire-dev-secret');
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    const authHeader: string | undefined = req.headers?.authorization;
    const headerToken =
      authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const queryToken =
      typeof req.query?.access_token === 'string' ? req.query.access_token : undefined;

    const token = headerToken || queryToken;
    if (!token) {
      throw new UnauthorizedException(ERR_AUTH_TOKEN_INVALID);
    }

    try {
      const payload = this.jwtService.verify<JWTPayload>(token, { secret: this.secret });
      req.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException(ERR_AUTH_TOKEN_INVALID);
    }
  }
}
