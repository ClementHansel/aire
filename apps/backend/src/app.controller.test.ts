import { describe, it, expect } from 'vitest';
import { AppService } from './app.service';

describe('AppService', () => {
  it('should return health status', () => {
    const service = new AppService();
    const result = service.getHealth();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('aire-backend');
    expect(result.timestamp).toBeDefined();
  });
});
