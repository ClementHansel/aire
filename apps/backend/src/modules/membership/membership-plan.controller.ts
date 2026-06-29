import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { JWTPayload, ERR_VALIDATION_FAILED } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
import { MembershipPlanService } from './membership-plan.service';
import { CreateMembershipPlanDto, UpdateMembershipPlanDto } from './dto';
import { MembershipPlan } from './interfaces';

@Controller('api/membership-plans')
@UseGuards(JwtAuthGuard)
export class MembershipPlanController {
  constructor(private readonly membershipPlanService: MembershipPlanService) {}

  /**
   * POST /api/membership-plans
   * Create a new membership plan for the authenticated user's tenant.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: JWTPayload,
    @Body() dto: CreateMembershipPlanDto,
  ): Promise<MembershipPlan> {
    if (!dto.name || !dto.durationMonths || !dto.maxUses || dto.price === undefined) {
      throw new BadRequestException(ERR_VALIDATION_FAILED);
    }

    return this.membershipPlanService.createPlan(user.tenant_id, dto);
  }

  /**
   * GET /api/membership-plans
   * List plans for the authenticated user's tenant.
   * Optionally filter by outlet scope.
   */
  @Get()
  async list(
    @CurrentUser() user: JWTPayload,
    @Query('outletId') outletId?: string,
  ): Promise<MembershipPlan[]> {
    return this.membershipPlanService.listPlans(user.tenant_id, outletId);
  }

  /**
   * GET /api/membership-plans/:id
   * Get a single membership plan by ID.
   */
  @Get(':id')
  async get(@Param('id') id: string): Promise<MembershipPlan> {
    return this.membershipPlanService.getPlan(id);
  }

  /**
   * PUT /api/membership-plans/:id
   * Update a membership plan. Changes only affect NEW memberships.
   */
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateMembershipPlanDto,
  ): Promise<MembershipPlan> {
    return this.membershipPlanService.updatePlan(id, dto);
  }

  /**
   * DELETE /api/membership-plans/:id
   * Soft delete a plan (set is_active = false).
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string): Promise<void> {
    return this.membershipPlanService.deletePlan(id);
  }
}
