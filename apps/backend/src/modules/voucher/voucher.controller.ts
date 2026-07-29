import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, RequirePermission } from '../../common/decorators';
import { PermissionsGuard } from '../../common/guards';
import { VoucherTemplateService } from './voucher-template.service';
import { VoucherPackService } from './voucher-pack.service';
import { VoucherRedemptionService } from './voucher-redemption.service';
import { CreateVoucherTemplateDto } from './voucher.interfaces';

interface SellPackBody {
  templateId: string;
  customer: { name: string; phone: string };
}

interface IssuePackBody {
  orderId: string;
  templateId: string;
}

interface ValidateBody {
  code: string;
  outletId?: string;
  vehicleBrand?: string;
  serviceIdsInCart?: string[];
  orderSubtotal?: number;
}

/**
 * Voucher pack sales + catalog — a POS till flow, not dashboard administration.
 *
 * `sell` and `issue` deliberately carry NO @RequirePermission, matching the two
 * sibling POS sale endpoints (`POST /api/orders` and `POST /api/memberships/sell`,
 * both JwtAuthGuard-only). They used to require `vouchers.write`, which is the
 * key gating voucher TEMPLATE management on the dashboard (see
 * VoucherTemplateController below). Reusing it here meant any tenant who built a
 * restricted cashier role — naturally leaving "manage voucher templates" off —
 * silently lost the ability to sell voucher packs at the till, with only a bare
 * "Insufficient permissions" 403 to go on (AIRIN-128). Confirmed against real
 * data: a custom role named "POS Only" holds ["transactions.read",
 * "customers.read"] and 403s here while ordinary sales and membership sales work.
 *
 * Cashier-level authorisation still applies via JwtAuthGuard + the role
 * hierarchy; this only stops a dashboard-admin permission from gating a till
 * action. If POS selling should ever be gated, it needs its own key applied
 * consistently to all three sale endpoints — not one of them.
 */
@Controller('api/voucher-packs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VoucherPackController {
  constructor(
    private readonly templates: VoucherTemplateService,
    private readonly packs: VoucherPackService,
  ) {}

  /** GET /api/voucher-packs/catalog — sellable templates for this tenant. */
  @Get('catalog')
  async catalog(@CurrentUser() user: JWTPayload) {
    return this.templates.listCatalog(user.tenant_id);
  }

  /** POST /api/voucher-packs/sell — reserve a sale (customer + pending order). */
  @Post('sell')
  @HttpCode(HttpStatus.CREATED)
  async sell(@CurrentUser() user: JWTPayload, @Body() body: SellPackBody) {
    if (!body.templateId || !body.customer?.name?.trim() || !body.customer?.phone?.trim()) {
      throw new BadRequestException('templateId and customer name/phone are required');
    }
    return this.packs.sellPack(user, body.templateId, body.customer);
  }

  /** POST /api/voucher-packs/issue — generate + deliver codes after payment. */
  @Post('issue')
  @HttpCode(HttpStatus.CREATED)
  async issue(@CurrentUser() user: JWTPayload, @Body() body: IssuePackBody) {
    if (!body.orderId || !body.templateId) {
      throw new BadRequestException('orderId and templateId are required');
    }
    return this.packs.issuePack(user, body.orderId, body.templateId);
  }
}

/**
 * Voucher template management (dashboard).
 */
@Controller('api/voucher-templates')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VoucherTemplateController {
  constructor(private readonly templates: VoucherTemplateService) {}

  @Get()
  async list(@CurrentUser() user: JWTPayload) {
    return this.templates.listCatalog(user.tenant_id);
  }

  @Post()
  @RequirePermission('vouchers.write')
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: JWTPayload, @Body() dto: CreateVoucherTemplateDto) {
    return this.templates.createTemplate(user.tenant_id, dto);
  }

  @Put(':id')
  @RequirePermission('vouchers.write')
  async update(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Body() dto: Partial<CreateVoucherTemplateDto>,
  ) {
    return this.templates.updateTemplate(user.tenant_id, id, dto);
  }

  @Delete(':id')
  @RequirePermission('vouchers.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JWTPayload, @Param('id') id: string): Promise<void> {
    return this.templates.deactivateTemplate(user.tenant_id, id);
  }
}

/**
 * Voucher validation (POS pre-check before placing an order).
 */
@Controller('api/vouchers')
@UseGuards(JwtAuthGuard)
export class VoucherController {
  constructor(private readonly redemption: VoucherRedemptionService) {}

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  async validate(@CurrentUser() user: JWTPayload, @Body() body: ValidateBody) {
    if (!body.code?.trim()) throw new BadRequestException('code is required');
    return this.redemption.validate(user.tenant_id, body.code, {
      outletId: body.outletId ?? user.outlet_id ?? '',
      vehicleBrand: body.vehicleBrand,
      serviceIdsInCart: body.serviceIdsInCart ?? [],
      orderSubtotal: body.orderSubtotal ?? 0,
      currentDate: new Date().toISOString().slice(0, 10),
    });
  }
}
