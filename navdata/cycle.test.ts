import { describe, expect, it } from 'vitest';
import { airacIdent, csvZipUrl, cycleFor, nextCycle } from './cycle.ts';

describe('cycleFor', () => {
  it('maps dates to the 28-day cycle in force', () => {
    expect(cycleFor(new Date('2026-10-01T00:00:00Z'))).toBe('2026-10-01');
    expect(cycleFor(new Date('2026-10-10T17:00:00Z'))).toBe('2026-10-01');
    expect(cycleFor(new Date('2026-10-28T23:59:59Z'))).toBe('2026-10-01');
    expect(cycleFor(new Date('2026-10-29T00:00:00Z'))).toBe('2026-10-29');
    expect(cycleFor(new Date('2026-09-30T12:00:00Z'))).toBe('2026-09-03');
  });
});

describe('nextCycle', () => {
  it('adds 28 days', () => {
    expect(nextCycle('2026-10-01')).toBe('2026-10-29');
    expect(nextCycle('2026-12-24')).toBe('2027-01-21');
  });
});

describe('csvZipUrl', () => {
  it('builds the FAA download URL', () => {
    expect(csvZipUrl('2026-10-01', 'APT')).toBe('https://nfdc.faa.gov/webContent/28DaySub/extra/01_Oct_2026_APT_CSV.zip');
  });
});

describe('airacIdent', () => {
  it('numbers cycles within their effective year', () => {
    expect(airacIdent('2026-01-22')).toBe('2601');
    expect(airacIdent('2026-10-01')).toBe('2610');
    expect(airacIdent('2026-12-24')).toBe('2613');
    expect(airacIdent('2027-01-21')).toBe('2701');
  });
});
