import {
  Controller, Get, Post, Put, Delete, Param, Body, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { BookingService, CreateBookingDto, UpdateBookingDto } from './booking.service';

@Controller('api/bookings')
@UseGuards(JwtAuthGuard)
export class BookingController {
  constructor(private readonly service: BookingService) {}

  @Get()
  list(@CurrentUser() user: JWTPayload, @Query('status') status?: string, @Query('outletId') outletId?: string) {
    // Outlet-scoped roles can't narrow to another branch; owners/admins can.
    const effective = user.role === Role.Cashier || user.role === Role.OutletAdmin ? undefined : outletId;
    return this.service.list(user.tenant_id, status, effective);
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
