import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import {
  AgentFlowService, type FlowKind,
  type CreateAgentFlowDto, type UpdateAgentFlowDto, type UpdateTenantFlowSelectionDto,
} from './agent-flow.service';

/**
 * Platform-admin CATALOG management. Only the super-admin (who owns the hosted
 * n8n instance) registers/edits which workflows exist.
 */
@Controller('api/agent-flows')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PlatformSuperAdmin)
export class AgentFlowAdminController {
  constructor(private readonly flows: AgentFlowService) {}

  @Get() list(@Query('kind') kind?: FlowKind) { return this.flows.listFlows(kind); }
  @Post() create(@Body() dto: CreateAgentFlowDto) { return this.flows.createFlow(dto); }
  @Put(':id') update(@Param('id') id: string, @Body() dto: UpdateAgentFlowDto) { return this.flows.updateFlow(id, dto); }
  @Patch(':id') patch(@Param('id') id: string, @Body() dto: UpdateAgentFlowDto) { return this.flows.updateFlow(id, dto); }
  @Delete(':id') remove(@Param('id') id: string) { return this.flows.deleteFlow(id).then(() => ({ ok: true })); }
}

/**
 * Tenant-facing selection: choose a published flow, flip routing mode, and mint
 * the bridge token to paste into n8n. Tenants never touch the catalog itself.
 */
@Controller('api/agent-flow-selection')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TenantOwner)
export class AgentFlowSelectionController {
  constructor(private readonly flows: AgentFlowService) {}

  /** Flows the tenant may pick from (enabled catalog entries). */
  @Get('available') available(@Query('kind') kind?: FlowKind) { return this.flows.availableFlows(kind); }

  @Get() get(@CurrentUser() u: JWTPayload) { return this.flows.getSelection(u.tenant_id); }

  @Put() update(@CurrentUser() u: JWTPayload, @Body() dto: UpdateTenantFlowSelectionDto) {
    return this.flows.updateSelection(u.tenant_id, dto);
  }

  /** Mint/rotate the bridge token — returned once in plaintext. */
  @Post('token') token(@CurrentUser() u: JWTPayload) { return this.flows.regenerateBridgeToken(u.tenant_id); }
}
