import {
  Controller,
  Post,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, RequiresOnboarding } from '../../common/decorators';
import { OnboardingCompleteGuard } from '../../common/guards';
import { PaymentService, QrisChargeResult } from './payment.service';

/**
 * Payment controller — initiates gateway charges from the POS.
 */
@Controller('api/payments')
@UseGuards(JwtAuthGuard, OnboardingCompleteGuard)
@RequiresOnboarding()
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  /**
   * POST /api/payments/charge/:orderId
   * Creates a dynamic QRIS charge for the order and returns the QR string.
   */
  @Post('charge/:orderId')
  @HttpCode(HttpStatus.OK)
  async charge(
    @CurrentUser() user: JWTPayload,
    @Param('orderId') orderId: string,
  ): Promise<QrisChargeResult> {
    return this.paymentService.createQrisCharge(user.tenant_id, orderId);
  }
}
