/**
 * ERAM message types (`flight/@source`) that carry the flight-plan lifecycle (spec §6.2): flight plan,
 * amendment, update, departure, arrival, cancellation, drop track, aircraft-ID amendment.
 * Everything else, above all the high-volume TH tracks, is dropped.
 */
export const KEPT_SOURCES: ReadonlySet<string> = new Set(['FH', 'AH', 'HU', 'DH', 'HV', 'CL', 'RH', 'IH']);

const NEEDLES = [...KEPT_SOURCES].map((s) => ` source="${s}"`);

/** Cheap substring test on the raw payload, before any XML parsing: can it hold a kept message? */
export function mayContainKept(raw: string): boolean {
  return NEEDLES.some((n) => raw.includes(n));
}
