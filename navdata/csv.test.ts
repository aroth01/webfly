import { describe, expect, it } from 'vitest';
import { readCsv } from './csv.ts';

describe('readCsv', () => {
  it('parses quoted NASR-style CSV with empty and numeric fields', () => {
    const text = '"FIX_ID","LAT_DECIMAL","LONG_DECIMAL","REMARK"\n"AAALL",42.12018888,-71.14176111,""\n';
    expect(readCsv(text)).toEqual([
      { FIX_ID: 'AAALL', LAT_DECIMAL: '42.12018888', LONG_DECIMAL: '-71.14176111', REMARK: '' },
    ]);
  });
});
