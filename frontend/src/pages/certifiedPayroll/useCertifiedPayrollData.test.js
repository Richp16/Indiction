import { describe, it, expect } from 'vitest';
import {
  safeParseDate,
  buildPaychexPeriodLabel,
  normalizePaychexPeriodOption,
} from './useCertifiedPayrollData';

describe('normalizePaychexPeriodOption label guards', () => {
  it('safeParseDate rejects invalid values', () => {
    expect(safeParseDate('2026-06-14')?.toISOString().slice(0, 10)).toBe('2026-06-14');
    expect(safeParseDate(null)).toBeNull();
    expect(safeParseDate('Invalid Date')).toBeNull();
    expect(safeParseDate('not-a-date')).toBeNull();
  });

  it('formats valid date ranges', () => {
    expect(
      buildPaychexPeriodLabel({
        startDate: '2026-06-14',
        endDate: '2026-06-27',
        description: 'Biweekly',
        checkCount: 37,
        payPeriodId: '1140037241110861',
      })
    ).toBe('Jun 14 – Jun 27, 2026');
  });

  it('falls back when dates are invalid', () => {
    const option = normalizePaychexPeriodOption({
      payPeriodId: '1140037241110001',
      startDate: 'bogus',
      endDate: null,
      description: null,
      checkCount: 5,
      label: 'Invalid Date – Invalid Date, NaN',
    });

    expect(option.label).toBe('Pay period (5 checks)');
    expect(option.displayLabel).toBe('Pay period (5 checks)');
    expect(option.label).not.toMatch(/Invalid Date/i);
    expect(option.week2End).toBeNull();
  });

  it('labels void periods without date math', () => {
    const option = normalizePaychexPeriodOption({
      payPeriodId: '1140037241110002',
      startDate: '2026-01-01',
      endDate: '2026-01-14',
      description: 'Void',
      checkCount: 0,
    });

    expect(option.label).toBe('Void (0 checks)');
    expect(option.hasValidDates).toBe(false);
  });
});
