import { describe, it, expect } from 'vitest';
import { classifyMemberSearch } from './memberSearch';

describe('classifyMemberSearch', () => {
  it('reads a 12-digit Indonesian mobile as a PHONE, not a member number', () => {
    // The regression: 12 digits is both a common mobile length and the member
    // number length, and reading it as a number returned "Customer not found"
    // for a customer who was standing at the counter.
    expect(classifyMemberSearch('081200000091').key).toBe('phone');
    expect(classifyMemberSearch('6281200000091').key).toBe('phone');
  });

  it('still reads shorter and longer phone numbers as phones', () => {
    expect(classifyMemberSearch('08123456789').key).toBe('phone');
    expect(classifyMemberSearch('0812345678901').key).toBe('phone');
  });

  it('reads a member number that carries letters as a NUMBER', () => {
    expect(classifyMemberSearch('00000101000A').key).toBe('number');
    expect(classifyMemberSearch('AB12CD34EF56').key).toBe('number');
  });

  it('reads a plate as a PLATE', () => {
    expect(classifyMemberSearch('B 9091 VRF').key).toBe('plate');
    expect(classifyMemberSearch('B9091VRF').key).toBe('plate');
  });

  it('always offers the other interpretation for the ambiguous formats', () => {
    // This is what makes a wrong guess recoverable rather than a dead end.
    expect(classifyMemberSearch('081200000091').alternateKey).toBe('number');
    expect(classifyMemberSearch('00000101000A').alternateKey).toBe('phone');
  });

  it('offers no alternate for a plate, which is unambiguous enough', () => {
    expect(classifyMemberSearch('B 9091 VRF').alternateKey).toBeNull();
  });

  it('tolerates surrounding whitespace', () => {
    expect(classifyMemberSearch('  081200000091  ').key).toBe('phone');
  });
});
