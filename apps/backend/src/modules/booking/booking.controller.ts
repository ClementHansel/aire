import {
  Controller, Get, Post, Put, Delete, Param, Body, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { ScopeService } from '../../common/scope/scope.service';
import { BookingService, CreateBookingDto, UpdateBookingDto } from './booking.service';

@Controller('api/bookings')
@UseGuards(JwtAuthGuard)
export class BookingController {
  constructor(
    private readonly service: BookingService,
    private readonly scope: ScopeService,
  ) {}

  @Get()
  async list(@CurrentUser() user: JWTPayload, @Query('status') status?: string, @Query('outletId') outletId?: string) {
    const ids = await this.scope.resolveOutletIds(user, outletId);
    return this.service.list(user.tenant_id, status, ids);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JWTPayload, @Body() dto: CreateBookingDto) {
    return this.service.create(user.tenant_id, dto);
  }

  @Put(':id')
  update(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: UpdateBookingDto) {
    return this.service.update(user.tenant_id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: JWTPayload, @Param('id') id: string): Promise<void> {
    return this.service.remove(user.tenant_id, id);
  }
}
