/** NAS "3530N/09720W" or ICAO "3530N09720W" (degrees + minutes). */
export const LATLON_RE = /^(\d{2})(\d{2})([NS])\/?(\d{3})(\d{2})([EW])$/;
/** ICAO whole-degree form "35N097W". */
export const LATLON_DEG_RE = /^(\d{2})([NS])(\d{3})([EW])$/;
/** ICAO speed/level groups like N0450F350, M082F370, K0830S1130. */
const SPEED_LEVEL_RE = /^[NKM]\d{3,4}([FAMS]\d{3,4}|VFR)$/;
const NOISE = new Set(['DCT', 'IFR', 'VFR']);

/**
 * Split a route string into meaningful tokens. Accepts NAS format (KDFW.AKUNA9.MLC..SGF),
 * ICAO format (KDFW DCT ABI/N0450F350 J52 TXO) and FAA preferred-route format (DFW AKUNA9 MLC).
 */
export function tokenizeRoute(text: string): string[] {
  const tokens: string[] = [];
  for (const raw of text.toUpperCase().replace(/\.\./g, ' ').replace(/\./g, ' ').split(/\s+/)) {
    let tok = raw;
    if (tok.includes('/') && !LATLON_RE.test(tok)) tok = tok.slice(0, tok.indexOf('/'));
    tok = tok.replace(/-(STAR|DP)$/, '');
    if (!tok || NOISE.has(tok) || SPEED_LEVEL_RE.test(tok)) continue;
    tokens.push(tok);
  }
  return tokens;
}
