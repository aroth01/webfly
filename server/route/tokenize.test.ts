import { describe, expect, it } from 'vitest';
import { tokenizeRoute } from './tokenize.ts';

describe('tokenizeRoute', () => {
  it('splits NAS dot format', () => {
    expect(tokenizeRoute('KDFW.AKUNA9.MLC..SGF.WELTS.TRTLL6.KORD')).toEqual(['KDFW', 'AKUNA9', 'MLC', 'SGF', 'WELTS', 'TRTLL6', 'KORD']);
  });

  it('drops DCT, speed/level groups and slash suffixes in ICAO format', () => {
    expect(tokenizeRoute('KDFW DCT ABI/N0450F350 J52 TXO DCT KLAX')).toEqual(['KDFW', 'ABI', 'J52', 'TXO', 'KLAX']);
  });

  it('keeps NAS lat/lon tokens intact', () => {
    expect(tokenizeRoute('KAAA..3530N/09720W..KBBB')).toEqual(['KAAA', '3530N/09720W', 'KBBB']);
  });

  it('strips -STAR/-DP suffixes and radar-vector slashes, and uppercases', () => {
    expect(tokenizeRoute('CYYZ BETES-DP FOXEE')).toEqual(['CYYZ', 'BETES', 'FOXEE']);
    expect(tokenizeRoute('kdfw./.abi')).toEqual(['KDFW', 'ABI']);
  });

  it('returns nothing for noise-only input', () => {
    expect(tokenizeRoute('  N0450F350 IFR VFR  ')).toEqual([]);
  });
});
