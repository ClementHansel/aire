import { describe, it, expect } from 'vitest';

describe('HomePage', () => {
  it('should define the page component', async () => {
    const { default: HomePage } = await import('./page');
    expect(HomePage).toBeDefined();
    expect(typeof HomePage).toBe('function');
  });
});
