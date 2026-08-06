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
    /**
     * One value of unknown kind — the server works out whether it is a membership
     * number, a phone, or a plate. Preferred for a single search box: the three
     * formats overlap (a 12-digit mobile looks exactly like a membership number)
     * and only the server knows this tenant's number prefix. The explicit
     * phone/plate/number params remain for callers that already know.
     */
    @Query('q') q?: string,
  ) {
    let result;
    if (q?.trim()) {
      result = await this.service.resolveIdentifier(user.tenant_id, q);
    } else if (number?.trim()) {
      result = await this.service.lookupByMembershipNumber(user.tenant_id, number);
    } else if (phone?.trim()) {
      result = await this.service.lookupByPhone(user.tenant_id, phone);
    } else if (plate?.trim()) {
      result = await this.service.lookupByPlate(user.tenant_id, plate);
    } else {
      throw new BadRequestException(
        'Provide q (any identifier), or a membership number, phone, or license plate to look up',
      );
    }

    if (!result) {
      throw new NotFoundException('Customer not found');
    }
    return result;
  }
}
