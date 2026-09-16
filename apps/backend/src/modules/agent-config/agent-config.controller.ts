import { Controller, Get, Post, Put, Delete, Body, Param, Query, HttpCode, HttpStatus, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { AgentConfigService, UpdateAgentConfigDto, UpdateBranchWaConfigDto, KnowledgeUpdateDto } from './agent-config.service';
import { KnowledgeDocsService, CreateKnowledgeDocDto, UpdateKnowledgeDocDto } from './knowledge-docs.service';

@Controller('api/agent-config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TenantOwner)
export class AgentConfigController {
  constructor(
    private readonly service: AgentConfigService,
    private readonly docs: KnowledgeDocsService,
  ) {}

  @Get()
  get(@CurrentUser() user: JWTPayload) {
    return this.service.get(user.tenant_id);
  }

  @Put()
  update(@CurrentUser() user: JWTPayload, @Body() dto: UpdateAgentConfigDto) {
    return this.service.update(user.tenant_id, dto);
  }

  // ── Tenant-managed AI knowledge (product knowledge + customer-visibility) ────
  @Get('knowledge')
  getKnowledge(@CurrentUser() user: JWTPayload) {
    return this.service.getKnowledge(user.tenant_id);
  }

  @Put('knowledge')
  setKnowledge(@CurrentUser() user: JWTPayload, @Body() dto: KnowledgeUpdateDto) {
    return this.service.setKnowledge(user.tenant_id, dto);
  }

  // ── Knowledge-base documents (uploaded files + typed notes, migration 099) ──
  // Only the extracted TEXT is kept; it is appended to the customer AI's system
  // prompt and stays editable here, so a wrong line is fixed without re-uploading.

  @Get('knowledge/documents')
  listKnowledgeDocs(@CurrentUser() user: JWTPayload) {
    return this.docs.list(user.tenant_id);
  }

  /** Upload a file (txt/md/csv/json/html/pdf/docx) as a new document. */
  @Post('knowledge/documents/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { files: 1 } }))
  uploadKnowledgeDoc(
    @CurrentUser() user: JWTPayload,
    @UploadedFile() file: Express.Multer.File,
    @Body('title') title?: string,
    @Query('title') titleQuery?: string,
  ) {
    return this.docs.upload(user.tenant_id, file, title ?? titleQuery, user.sub);
  }

  /** Create a typed note (no file). */
  @Post('knowledge/documents')
  createKnowledgeDoc(@CurrentUser() user: JWTPayload, @Body() dto: CreateKnowledgeDocDto) {
    return this.docs.create(user.tenant_id, dto ?? {}, user.sub);
  }

  /** Replace an existing document's text with a newly uploaded file (keeps its id/position). */
  @Put('knowledge/documents/:id/file')
  @UseInterceptors(FileInterceptor('file', { limits: { files: 1 } }))
  replaceKnowledgeDocFile(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.docs.replaceFile(user.tenant_id, id, file, user.sub);
  }

  /** Edit an existing document (title / text / on-off / order). */
  @Put('knowledge/documents/:id')
  updateKnowledgeDoc(@CurrentUser() user: JWTPayload, @Param('id') id: string, @Body() dto: UpdateKnowledgeDocDto) {
    return this.docs.update(user.tenant_id, id, dto ?? {});
  }

  @Delete('knowledge/documents/:id')
  @HttpCode(HttpStatus.OK)
  deleteKnowledgeDoc(@CurrentUser() user: JWTPayload, @Param('id') id: string) {
    return this.docs.remove(user.tenant_id, id);
  }

  // ── Per-branch WhatsApp lines (only meaningful when perBranchWaEnabled) ──────
  @Get('branches')
  listBranches(@CurrentUser() user: JWTPayload) {
    return this.service.listBranchConfigs(user.tenant_id);
  }

  @Put('branches/:outletId')
  updateBranch(@CurrentUser() user: JWTPayload, @Param('outletId') outletId: string, @Body() dto: UpdateBranchWaConfigDto) {
    return this.service.updateBranchConfig(user.tenant_id, outletId, dto);
  }

  @Delete('branches/:outletId')
  @HttpCode(HttpStatus.OK)
  deleteBranch(@CurrentUser() user: JWTPayload, @Param('outletId') outletId: string) {
    return this.service.deleteBranchConfig(user.tenant_id, outletId);
  }
}
