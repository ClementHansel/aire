import { Controller, Get, Put, Delete, Body, Param, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { AgentConfigService, UpdateAgentConfigDto, UpdateBranchWaConfigDto, KnowledgeUpdateDto } from './agent-config.service';

@Controller('api/agent-config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TenantOwner)
export class AgentConfigController {
  constructor(private readonly service: AgentConfigService) {}

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
