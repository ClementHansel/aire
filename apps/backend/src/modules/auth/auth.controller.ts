import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  LoginRequest,
  LoginResponse,
  RefreshRequest,
  RefreshResponse,
  ERR_VALIDATION_FAILED,
} from '@aire/shared';

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
}
