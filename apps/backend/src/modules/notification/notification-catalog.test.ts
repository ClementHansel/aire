import { describe, it, expect } from 'vitest';
import {
  NOTIFICATION_CATALOG,
  CATEGORY_LABELS,
  AUDIENCE_LABELS,
  extractPlaceholders,
  unknownPlaceholders,
} from './notification-catalog';
import { fillTemplate, fillForKey, sampleVars, optionalVars } from './notification-renderer.service';

describe('notification catalogue integrity', () => {
  it('has no duplicate keys', () => {
    const keys = NOTIFICATION_CATALOG.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every default body only uses variables the entry declares', () => {
    // A default that referenced an undeclared variable would ship
    // "{namaPelanggan}" to a customer, and the editor would reject the very text
    // we shipped as the default.
    for (const def of NOTIFICATION_CATALOG) {
      expect(unknownPlaceholders(def.key, def.defaultBody), `${def.key} uses an undeclared variable`).toEqual([]);
    }
  });

  it('every declared variable is actually used by the default body', () => {
    // Otherwise the editor advertises a chip that does nothing until the owner
    // types it — harmless but confusing. `orderNumber` on queue_completion is
    // deliberately available-but-unused, so it is the documented exception.
    const allowedUnused = new Set(['queue_completion:orderNumber', 'membership_expiry_reminder:daysRemaining']);
    for (const def of NOTIFICATION_CATALOG) {
      const used = new Set(extractPlaceholders(def.defaultBody));
      for (const v of def.variables) {
        if (allowedUnused.has(`${def.key}:${v.name}`)) continue;
        expect(used.has(v.name), `${def.key} declares {${v.name}} but never uses it`).toBe(true);
      }
    }
  });

  it('every entry has a trigger description, a category and an audience label', () => {
    for (const def of NOTIFICATION_CATALOG) {
      expect(def.trigger.length, `${def.key} has no trigger prose`).toBeGreaterThan(20);
      expect(CATEGORY_LABELS[def.category]).toBeTruthy();
      expect(AUDIENCE_LABELS[def.audience]).toBeTruthy();
    }
  });

  it('locked entries cannot be disabled either', () => {
    // A locked body carries a credential; letting the owner switch the message
    // off would break the flow just as thoroughly as editing the code out.
    for (const def of NOTIFICATION_CATALOG.filter((d) => d.lockedReason)) {
      expect(def.canDisable, `${def.key} is locked but disableable`).toBe(false);
    }
  });

  it('renders every entry with its samples without leaving a placeholder behind', () => {
    for (const def of NOTIFICATION_CATALOG) {
      const out = fillForKey(def.key, def.defaultBody, sampleVars(def));
      expect(out, `${def.key} preview is empty`).not.toBe('');
      expect(out, `${def.key} preview leaked a placeholder`).not.toMatch(/\{[a-zA-Z]/);
    }
  });
});

describe('fillTemplate', () => {
  it('substitutes variables', () => {
    expect(fillTemplate('Halo {name}!', { name: 'Budi' })).toBe('Halo Budi!');
  });

  it('drops a line whose OPTIONAL variables are all empty', () => {
    const body = 'Halo!\nBerlaku sampai {expiryDate}.\nTerima kasih';
    const opt = new Set(['expiryDate']);
    expect(fillTemplate(body, { expiryDate: '' }, opt)).toBe('Halo!\nTerima kasih');
    expect(fillTemplate(body, { expiryDate: '1 Jan' }, opt)).toBe('Halo!\nBerlaku sampai 1 Jan.\nTerima kasih');
  });

  it('keeps a line built on a NON-optional variable even when it is empty', () => {
    // The greeting is the message; losing it would be worse than a missing name.
    expect(fillTemplate('Halo kak {customerName}!\nBye', { customerName: '' })).toBe('Halo kak!\nBye');
  });

  it('keeps a line where at least one variable has a value', () => {
    expect(fillTemplate('{a} dan {b}', { a: 'satu', b: '' }, new Set(['b']))).toBe('satu dan');
  });

  it('never leaves a dangling space before punctuation when a variable is empty', () => {
    // "Halo kak {customerName}!" for a walk-in with no name recorded must not
    // read "Halo kak !".
    expect(fillTemplate('Halo kak {customerName}! 🎉', { customerName: '' })).toBe('Halo kak! 🎉');
  });

  it('leaves deliberate spacing alone on lines that lost nothing', () => {
    expect(fillTemplate('Total  :  {total}', { total: 'Rp10' })).toBe('Total  :  Rp10');
  });

  it('expands a multi-line variable into multiple lines', () => {
    expect(fillTemplate('Kode:\n{codes}', { codes: '1. A\n2. B' })).toBe('Kode:\n1. A\n2. B');
  });

  it('collapses the blank runs left behind by dropped lines', () => {
    const body = 'Satu\n\n{gone}\n\nDua';
    expect(fillTemplate(body, { gone: '' }, new Set(['gone']))).toBe('Satu\n\nDua');
  });

  it('treats a missing key the same as an empty one', () => {
    expect(fillTemplate('Halo {nobody}!\nBye', {}, new Set(['nobody']))).toBe('Bye');
  });
});

describe('fillForKey uses the catalogue\'s declared optionality', () => {
  it('drops the expiry line for a voucher with no expiry date', () => {
    const out = fillForKey('voucher_purchased', 'Kode:\n{codeList}\nBerlaku sampai {expiryDate}.', {
      codeList: '1. AIRE-1',
      expiryDate: '',
    });
    expect(out).toBe('Kode:\n1. AIRE-1');
  });

  it('marks expiryDate optional but customerName required', () => {
    const opt = optionalVars(NOTIFICATION_CATALOG.find((d) => d.key === 'voucher_purchased')!);
    expect(opt.has('expiryDate')).toBe(true);
    expect(opt.has('customerName')).toBe(false);
  });
});

describe('unknownPlaceholders', () => {
  it('flags a variable the notification does not provide', () => {
    expect(unknownPlaceholders('membership_welcome', 'Halo {namaPelanggan}')).toEqual(['namaPelanggan']);
  });

  it('accepts declared variables', () => {
    expect(unknownPlaceholders('membership_welcome', 'Halo {customerName}, paket {planName}')).toEqual([]);
  });
});
