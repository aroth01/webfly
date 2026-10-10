const QUERY_RE = /^([A-Z]{3}|[A-Z0-9]{2})(\d{1,4})$/;

export type QueryCheck = { ok: true; query: string } | { ok: false; message: string };

/** Client-side mirror of the server's input check (it also maps airline codes), to avoid a pointless request. */
export function checkQuery(input: string): QueryCheck {
  const q = input.toUpperCase().replace(/\s+/g, '');
  const m = QUERY_RE.exec(q);
  if (!m || !/[A-Z]/.test(m[1]) || Number(m[2]) === 0) return { ok: false, message: 'Enter an airline code and flight number, like AA558.' };
  return { ok: true, query: q };
}
