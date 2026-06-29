import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { RlsContextGuard } from './rls-context.guard';

function createMockContext(user: Record<string, unknown> | null): {
  ctx: ExecutionContext;
  request: Record<string, unknown>;
} {
  const request: Record<string, unknown> = { user };
  return {
    ctx: {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
        getNext: () => ({}),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext,
    request,
  };
}

describe('RlsContextGuard', () => {
  let guard: RlsContextGuard;
  let mockPool: { connect: ReturnType<typeof vi.fn> };
  let mockClient: {
    query: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      query: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    };

    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };

    guard = new RlsContextGuard(mockPool as any);
  });

  it('should return false if user is not present on request', async () => {
    const { ctx } = createMockContext(null);
    const result = await guard.canActivate(ctx);
    expect(result).toBe(false);
  });

  it('should begin a transaction and set session variables for a Cashier', async () => {
    const { ctx, request } = createMockContext({
      sub: 'user-1',
      tenant_id: 'tenant-abc',
      outlet_id: 'outlet-xyz',
      role: 'cashier',
    });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith(
      "SET LOCAL app.tenant_id = 'tenant-abc'",
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      "SET LOCAL app.outlet_id = 'outlet-xyz'",
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      "SET LOCAL app.role = 'cashier'",
    );
    expect(request.dbClient).toBe(mockClient);
  });

  it('should set outlet_id to empty string for TenantOwner (null outlet_id)', async () => {
    const { ctx } = createMockContext({
      sub: 'user-2',
      tenant_id: 'tenant-abc',
      outlet_id: null,
      role: 'tenant_owner',
    });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(mockClient.query).toHaveBeenCalledWith(
      "SET LOCAL app.outlet_id = ''",
    );
  });

  it('should set PlatformSuperAdmin session variables correctly', async () => {
    const { ctx } = createMockContext({
      sub: 'user-3',
      tenant_id: 'tenant-platform',
      outlet_id: null,
      role: 'platform_super_admin',
    });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(mockClient.query).toHaveBeenCalledWith(
      "SET LOCAL app.tenant_id = 'tenant-platform'",
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      "SET LOCAL app.role = 'platform_super_admin'",
    );
  });

  it('should attach dbClient to request for downstream usage', async () => {
    const { ctx, request } = createMockContext({
      sub: 'user-1',
      tenant_id: 'tenant-abc',
      outlet_id: 'outlet-xyz',
      role: 'cashier',
    });

    await guard.canActivate(ctx);

    expect(request.dbClient).toBe(mockClient);
  });

  it('should rollback and release client on query failure', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error('connection error')); // SET LOCAL fails

    const { ctx } = createMockContext({
      sub: 'user-1',
      tenant_id: 'tenant-abc',
      outlet_id: 'outlet-xyz',
      role: 'cashier',
    });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(false);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('should still release client if ROLLBACK itself fails', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error('set error')) // SET LOCAL fails
      .mockRejectedValueOnce(new Error('rollback error')); // ROLLBACK fails

    const { ctx } = createMockContext({
      sub: 'user-1',
      tenant_id: 'tenant-abc',
      outlet_id: 'outlet-xyz',
      role: 'cashier',
    });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(false);
    expect(mockClient.release).toHaveBeenCalled();
  });
});
