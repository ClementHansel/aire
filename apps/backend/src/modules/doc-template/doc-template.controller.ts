import { Controller, Delete, Get, Put, Body, Param, Query, Res, BadRequestException, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { DocTemplateService, DocTemplate, DocKind, DOC_KINDS } from './doc-template.service';
import { readUploadedImage, streamImage } from '../storage/upload.util';

/** Coerce an untrusted :kind route param to a valid document kind (or 400). */
function parseKind(kind: string): DocKind {
  if ((DOC_KINDS as string[]).includes(kind)) return kind as DocKind;
  throw new BadRequestException(`Unknown document kind: ${kind}`);
}

/** Invoice / receipt / report layout designer. Read by any staff; edited by OutletAdmin+. */
@Controller('api/doc-template')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocTemplateController {
  constructor(private readonly service: DocTemplateService) {}

  @Get(':kind')
  get(@CurrentUser() user: JWTPayload, @Param('kind') kind: string) {
    return this.service.get(user.tenant_id, parseKind(kind));
  }

  @Put(':kind')
  @Roles(Role.OutletAdmin)
  set(@CurrentUser() user: JWTPayload, @Param('kind') kind: string, @Body() body: DocTemplate) {
    return this.service.set(user.tenant_id, parseKind(kind), body);
  }

  /** PUT /api/doc-template/:kind/background — upload the document background (multipart). */
  @Put(':kind/background')
  @Roles(Role.OutletAdmin)
  @UseInterceptors(FileInterceptor('file', { limits: { files: 1 } }))
  async setBackground(@CurrentUser() user: JWTPayload, @Param('kind') kind: string, @UploadedFile() file: Express.Multer.File): Promise<DocTemplate> {
    const { buffer, contentType } = readUploadedImage(file);
    return this.service.setBackground(user.tenant_id, parseKind(kind), buffer, contentType);
  }

  /** DELETE /api/doc-template/:kind/background — remove the document background. */
  @Delete(':kind/background')
  @Roles(Role.OutletAdmin)
  removeBackground(@CurrentUser() user: JWTPayload, @Param('kind') kind: string): Promise<DocTemplate> {
    return this.service.removeBackground(user.tenant_id, parseKind(kind));
  }
}

/**
 * Public read of a document TEMPLATE (layout only — no order/customer data) so
 * the POS (which is not a dashboard session) can render a designed receipt.
 * No auth: the template is not sensitive.
 */
@Controller('api/public/doc-template')
export class PublicDocTemplateController {
  constructor(private readonly service: DocTemplateService) {}

  @Get(':kind')
  get(@Param('kind') kind: string, @Query('tenantId') tenantId: string) {
    return this.service.get(tenantId, parseKind(kind));
  }

  /** GET /api/public/doc-template/:kind/background?tenantId= — stream the background image. */
  @Get(':kind/background')
  async background(@Param('kind') kind: string, @Query('tenantId') tenantId: string | undefined, @Res() res: Response): Promise<void> {
    const obj = tenantId ? await this.service.getBackground(tenantId, parseKind(kind)) : null;
    streamImage(res, obj);
  }
}
