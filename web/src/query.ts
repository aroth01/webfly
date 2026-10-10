/** Same rule as the server (spec §7.1): airline code + 1-4 digit flight number. */
const QUERY_RE = /^([A-Z]{3}|[A-Z0-9]{2})(\d{1,4})$/;

/** Uppercased query without spaces, or undefined when it isn't a flight number. */
export function cleanQuery(input: string): string | undefined {
  const q = input.toUpperCase().replace(/\s+/g, '');
  return QUERY_RE.test(q) ? q : undefined;
}
