import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocTemplateService, DocTemplate } from './doc-template.service';

describe('DocTemplateService', () => {
  let service: DocTemplateService;
  let mockPool: { query: ReturnType<typeof vi.fn> };
  let mockStorage: { put: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = { query: vi.fn() };
    mockStorage = { put: vi.fn().mockResolvedValue(undefined), get: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) };
    service = new DocTemplateService(mockPool as any, mockStorage as any);
  });

  describe('get', () => {
    it('returns the per-kind default template when none is stored', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ tpl: null }] });
      const tpl = await service.get('tenant-1', 'invoice');
      expect(tpl.kind).toBe('invoice');
      expect(tpl.paper).toBe('A4');
      expect(tpl.elements.some((e) => e.type === 'table')).toBe(true);
    });

    it('defaults the receipt to a thermal layout', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ tpl: null }] });
      const tpl = await service.get('tenant-1', 'receipt');
      expect(tpl.paper).toBe('thermal80');
    });

    it('normalizes a stored template', async () => {
      const stored: Partial<DocTemplate> = { kind: 'invoice', paper: 'A4', width: 595, height: 842, backgroundImage: null, elements: [] };
      mockPool.query.mockResolvedValueOnce({ rows: [{ tpl: stored }] });
      const tpl = await service.get('tenant-1', 'invoice');
      expect(tpl.elements).toEqual([]);
    });
  });

  describe('set', () => {
    it('persists under the kind-specific settings key and re-reads', async () => {
      const tpl: DocTemplate = { kind: 'report', paper: 'A4', width: 595, height: 842, backgroundImage: null, elements: [], reportSections: { kpis: false } };
      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // UPDATE
        .mockResolvedValueOnce({ rows: [{ tpl }] }); // subsequent get
      const out = await service.set('tenant-1', 'report', tpl);
      const updateArgs = mockPool.query.mock.calls[0];
      expect(updateArgs[1]).toEqual(['tenant-1', 'reportTemplate', JSON.stringify({ ...tpl })]);
      expect(out.reportSections).toEqual({ kpis: false });
    });

    it('drops an inline data: background rather than persisting a blob', async () => {
      const existing: DocTemplate = { kind: 'invoice', paper: 'A4', width: 595, height: 842, backgroundImage: '/api/public/doc-template/invoice/background?v=abc', elements: [] };
      const incoming: DocTemplate = { ...existing, backgroundImage: 'data:image/png;base64,AAAA' };
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ tpl: existing }] }) // get() for data: guard
        .mockResolvedValueOnce({ rows: [] }) // UPDATE
        .mockResolvedValueOnce({ rows: [{ tpl: existing }] }); // final get
      await service.set('tenant-1', 'invoice', incoming);
      const persisted = JSON.parse(mockPool.query.mock.calls[1][1][2]);
      expect(persisted.backgroundImage).toBe(existing.backgroundImage);
    });
  });

  describe('setBackground', () => {
    it('uploads to storage and stores a versioned public URL', async () => {
      const base: DocTemplate = { kind: 'invoice', paper: 'A4', width: 595, height: 842, backgroundImage: null, elements: [] };
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ tpl: base }] }) // get() before set
        .mockResolvedValueOnce({ rows: [] }) // UPDATE
        .mockResolvedValueOnce({ rows: [{ tpl: base }] }); // final get
      await service.setBackground('tenant-1', 'invoice', Buffer.from('img'), 'image/png');
      expect(mockStorage.put).toHaveBeenCalledWith('tenants/tenant-1/doc-invoice-bg', expect.any(Buffer), 'image/png');
      const persisted = JSON.parse(mockPool.query.mock.calls[1][1][2]);
      expect(persisted.backgroundImage).toMatch(/^\/api\/public\/doc-template\/invoice\/background\?tenantId=tenant-1&v=/);
    });
  });
});
