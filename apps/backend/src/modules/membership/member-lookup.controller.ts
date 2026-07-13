import {
  Controller,
  Get,
  Query,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { MemberLookupService } from './member-lookup.service';

/**
 * Member lookup for POS / CRM.
 *
 * Resolves a customer (with memberships, plates, daily usage and vouchers)
 * by phone number or license plate. Available to any authenticated staff so
 * that cashiers can prefill orders at the POS (including from the queue).
 *
 * Prefers phone when supplied, falling back to plate — mirroring the
 * `useMemberLookup` frontend hook contract (GET /api/members/lookup).
 */
@Controller('api/members')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MemberLookupController {
  constructor(private readonly service: MemberLookupService) {}

  @Get('lookup')
  async lookup(
    @CurrentUser() user: JWTPayload,
    @Query('phone') phone?: string,
    @Query('plate') plate?: string,
    @Query('number') number?: string,
  ) {
    let result;
    if (number?.trim()) {
      result = await this.service.lookupByMembershipNumber(user.tenant_id, number);
    } else if (phone?.trim()) {
      result = await this.service.lookupByPhone(user.tenant_id, phone);
    } else if (plate?.trim()) {
      result = await this.service.lookupByPlate(user.tenant_id, plate);
    } else {
      throw new BadRequestException(
        'Provide a membership number, phone, or license plate to look up',
      );
    }

    if (!result) {
      throw new NotFoundException('Customer not found');
    }
    return result;
  }
}
