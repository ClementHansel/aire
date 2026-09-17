import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthService, RegisterRequest } from './auth.service';
import {
  JWTPayload,
  LoginRequest,
  LoginResponse,
  RefreshRequest,
  RefreshResponse,
  ERR_VALIDATION_FAILED,
} from '@aire/shared';
import { JwtAuthGuard } from './auth.guard';
import { CurrentUser } from '../../common/decorators';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /api/auth/login
   * Authenticates a user with email and password credentials.
   * Returns JWT access token, refresh token, and user info.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: LoginRequest): Promise<LoginResponse> {
    if (!body.email || !body.password) {
      throw new BadRequestException(ERR_VALIDATION_FAILED);
    }

    return this.authService.login(body);
  }

  /**
   * POST /api/auth/register
   * Self-service signup — creates a tenant + owner and returns tokens.
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() body: RegisterRequest,
    @Req() req: { ip?: string; headers?: Record<string, unknown> },
  ): Promise<LoginResponse> {
    // Behind nginx the socket address is the proxy, so prefer the forwarded
    // address when present. Only used as a rate-limit bucket — never trusted
    // for authorization — so a spoofed value costs the caller their own bucket.
    const forwarded = String(req?.headers?.['x-forwarded-for'] ?? '').split(',')[0]?.trim();
    return this.authService.register(body, forwarded || req?.ip || undefined);
  }

  /**
   * POST /api/auth/forgot-password
   * Issues a password reset token.
   */
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() body: { email: string }) {
    return this.authService.forgotPassword(body?.email);
  }

  /**
   * POST /api/auth/reset-password
   * Resets a password using a valid reset token.
   */
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() body: { token: string; newPassword: string }) {
    return this.authService.resetPassword(body?.token, body?.newPassword);
  }

  /**
   * POST /api/auth/refresh
   * Validates a refresh token and issues a new token pair.
   * Implements token rotation — the old refresh token is invalidated.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: RefreshRequest): Promise<RefreshResponse> {
    if (!body.refreshToken) {
      throw new BadRequestException(ERR_VALIDATION_FAILED);
    }

    return this.authService.refresh(body.refreshToken);
  }

  /**
   * GET /api/auth/me — the signed-in user, READ FRESH FROM THE DATABASE.
   *
   * The frontend caches the user in localStorage at login and never refreshed it,
   * so renaming somebody updated every server-rendered list (the POS salesperson
   * dropdown among them) while the name in the top-right corner stayed whatever
   * it was the day they signed in. Signing out and back in fixed it, which is not
   * something anyone should have to know.
   *
   * Reads the row rather than echoing the JWT: the token carries the claims
   * minted at login, so trusting it here would reproduce the same staleness
   * through a different pipe.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: JWTPayload) {
    return this.authService.currentUser(user.sub);
  }
}
