import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JWTPayload, ERR_AUTH_TOKEN_INVALID } from '@aire/shared';
import { AuthService } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET', 'aire-dev-secret'),
    });
  }

  /**
   * Called by Passport after a valid JWT is decoded.
   * Returns the payload to be attached to request.user.
   */
  async validate(payload: JWTPayload): Promise<JWTPayload> {
    const validated = await this.authService.validateJwtPayload(payload);
    if (!validated) {
      throw new UnauthorizedException(ERR_AUTH_TOKEN_INVALID);
    }
    return validated;
  }
}
