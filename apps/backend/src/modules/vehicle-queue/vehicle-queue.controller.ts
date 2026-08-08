import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { VehicleQueueService, AddArrivalDto } from './vehicle-queue.service';

@Controller('api/vehicle-queue')
@UseGuards(JwtAuthGuard)
export class VehicleQueueController {
  constructor(private readonly service: VehicleQueueService) {}

  @Get()
  list(@CurrentUser() user: JWTPayload, @Query('outletId') outletId?: string, @Query('includeDone') includeDone?: string) {
    const oid = outletId ?? user.outlet_id;
    if (!oid) throw new BadRequestException('outletId is required');
    return this.service.list(user.tenant_id, oid, includeDone === 'true');
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  add(@CurrentUser() user: JWTPayload, @Body() dto: AddArrivalDto) {
    return this.service.add(user.tenant_id, { ...dto, outletId: dto.outletId ?? user.outlet_id! });
  }

  @Patch(':id/status')
  setStatus(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    // `reason` accompanies a cancellation: a car that leaves the board unserved
    // has to say why (AIRIN-171).
    @Body() body: { status: 'waiting' | 'serving' | 'done' | 'cancelled'; reason?: string },
  ) {
    return this.service.setStatus(user.tenant_id, id, body.status, body.reason);
  }
}
