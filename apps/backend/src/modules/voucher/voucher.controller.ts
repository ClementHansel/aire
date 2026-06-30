import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators';
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
 * Voucher pack sales + catalog.
 */
@Controller('api/voucher-packs')
@UseGuards(JwtAuthGuard)
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
@UseGuards(JwtAuthGuard)
export class VoucherTemplateController {
  constructor(private readonly templates: VoucherTemplateService) {}

  @Get()
  async list(@CurrentUser() user: JWTPayload) {
    return this.templates.listCatalog(user.tenant_id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: JWTPayload, @Body() dto: CreateVoucherTemplateDto) {
    return this.templates.createTemplate(user.tenant_id, dto);
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
