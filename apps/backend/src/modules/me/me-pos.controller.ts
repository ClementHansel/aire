import { Controller, Get, UseGuards } from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { MeService } from './me.service';

/**
 * POS branch resolution, split out of MeController on purpose: that controller
 * is fully disabled while lean mode is on (LeanDisabledGuard('Employee
 * self-service')), but the POS needs its operating-branch resolution exactly
 * during lean mode, since lean mode is when POS is the focused surface. Any
 * authenticated login may call this — a cashier is not linked to an employee
 * record's self-service data here, just their own current branch.
 */
@Controller('api/me')
@UseGuards(JwtAuthGuard)
export class MePosController {
  constructor(private readonly service: MeService) {}

  @Get('pos-branch')
  posBranch(@CurrentUser() user: JWTPayload) {
    return this.service.posBranch(user.tenant_id, user.sub);
  }
}
