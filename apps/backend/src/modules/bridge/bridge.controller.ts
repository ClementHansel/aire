import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Res,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { JWTPayload, Role } from '@aire/shared';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { BridgeService, BridgeDTO } from './bridge.service';
import { BridgeGateway } from './bridge.gateway';

/** Body for provisioning a bridge. */
interface CreateBridgeBody {
  outletId: string;
  name?: string;
}

/** A bridge row enriched with the live socket-connection status. */
type BridgeWithLiveStatus = BridgeDTO & { live: boolean };

/** Provisioning response: the bridge + one-time token + copy-paste install commands. */
interface BridgePairingResponse {
  bridge: BridgeDTO;
  pairingToken: string;
  /** Primary install command (Windows PowerShell installer, token baked in). */
  installCommand: string;
  /** Other platforms surfaced behind a "more options" affordance. */
  altInstall: { linux: string; docker: string };
}

/**
 * BridgeController — Tenant_Owner management of branch-bridge agents.
 *
 * Provisioning surfaces the pairing token + a copy-paste install command
 * exactly once (on create / rotate). Tenant scope always comes from the JWT,
 * never the request body, so an owner can only manage their own outlets.
 */
@Controller('api/bridges')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TenantOwner)
export class BridgeController {
  constructor(
    private readonly bridgeService: BridgeService,
    private readonly gateway: BridgeGateway,
  ) {}

  /**
   * POST /api/bridges — provision a bridge for an outlet. Returns the bridge,
   * its one-time pairing token, and a ready-to-run install command.
   */
  @Post()
  async create(
    @CurrentUser() user: JWTPayload,
    @Body() body: CreateBridgeBody,
  ): Promise<BridgePairingResponse> {
    const { bridge, pairingToken } = await this.bridgeService.createBridge(
      user.tenant_id,
      body.outletId,
      body.name ?? null,
    );
    return {
      bridge,
      pairingToken,
      installCommand: this.installCommand(pairingToken),
      altInstall: this.altInstall(pairingToken),
    };
  }

  /** GET /api/bridges — list this tenant's bridges with live status. */
  @Get()
  async list(@CurrentUser() user: JWTPayload): Promise<BridgeWithLiveStatus[]> {
    const bridges = await this.bridgeService.listBridges(user.tenant_id);
    return bridges.map((b) => ({ ...b, live: this.gateway.isBridgeOnline(b.id) }));
  }

  /** POST /api/bridges/:id/rotate-token — issue a new token, invalidating the old. */
  @Post(':id/rotate-token')
  async rotate(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
  ): Promise<BridgePairingResponse> {
    const { bridge, pairingToken } = await this.bridgeService.rotateToken(user.tenant_id, id);
    return {
      bridge,
      pairingToken,
      installCommand: this.installCommand(pairingToken),
      altInstall: this.altInstall(pairingToken),
    };
  }

  /** DELETE /api/bridges/:id — remove a bridge (cameras are retained). */
  @Delete(':id')
  async remove(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
  ): Promise<{ success: true }> {
    await this.bridgeService.deleteBridge(user.tenant_id, id);
    return { success: true };
  }

  /**
   * GET /api/bridges/:id/installer — download the prebuilt Branch Bridge package.
   *
   * When `BRANCH_BRIDGE_PACKAGE` points at an existing zip on disk we stream it
   * as an attachment (`aire-branch-bridge.zip`). Otherwise we respond 503 with
   * `{ needsPackage: true, ... , installCommand }` so the wizard can fall back to
   * showing the copy-paste command (the pairing token is shown in the modal
   * regardless). Tenant-scoped: a missing/foreign bridge id → 404.
   */
  @Get(':id/installer')
  async installer(
    @CurrentUser() user: JWTPayload,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const ctx = await this.bridgeService.getInstallContext(user.tenant_id, id);
    if (!ctx) throw new NotFoundException('Bridge not found');

    const packagePath = process.env.BRANCH_BRIDGE_PACKAGE;
    if (packagePath && existsSync(packagePath) && statSync(packagePath).isFile()) {
      res.set({
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="aire-branch-bridge.zip"',
        'Content-Length': String(statSync(packagePath).size),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      createReadStream(packagePath).pipe(res);
      return;
    }

    res.status(503).json({
      needsPackage: true,
      message:
        'The Branch Bridge installer package is not hosted yet. Copy the install ' +
        'command below and run it on the branch machine instead.',
      installCommand: this.installCommand(ctx.pairingToken),
      altInstall: this.altInstall(ctx.pairingToken),
    });
  }

  /**
   * Build the one-liner an operator runs on the branch machine. `AIRE_CLOUD_URL`
   * is left as a shell variable placeholder so the same command works in dev and
   * prod (the operator exports it, or the UI substitutes the deployment URL).
   */
  private cloudUrl(): string {
    return (
      process.env.APP_PUBLIC_URL ||
      process.env.PUBLIC_APP_URL ||
      'https://app.useairin.id'
    );
  }

  /**
   * Primary install path: a PC installer (no Docker). The operator downloads the
   * Aire Branch Bridge installer, extracts it, and runs this in an elevated
   * PowerShell (Windows) — the token is baked in. Linux + Docker alternatives
   * are returned separately so the UI can offer them behind a "more options".
   */
  private installCommand(pairingToken: string): string {
    return `.\\install.ps1 -Token "${pairingToken}" -CloudUrl "${this.cloudUrl()}"`;
  }

  /** Alternative install commands surfaced under "other platforms". */
  private altInstall(pairingToken: string): { linux: string; docker: string } {
    const cloud = this.cloudUrl();
    const image =
      process.env.BRANCH_BRIDGE_IMAGE || 'ghcr.io/aire/branch-bridge:latest';
    return {
      linux: `sudo ./install.sh --token "${pairingToken}" --cloud-url "${cloud}"`,
      docker:
        `docker run -d --name aire-branch-bridge --restart unless-stopped --network host ` +
        `-e AIRE_CLOUD_URL="${cloud}" -e AIRE_BRIDGE_TOKEN="${pairingToken}" ${image}`,
    };
  }
}
