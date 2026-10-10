import { XMLParser } from 'fast-xml-parser';

/** The fields WebFly reads from one SFDPS `flight` element. Times are epoch seconds. */
export interface SfdpsFlight {
  source: string; // ERAM message type, e.g. "FH"
  centre?: string;
  timestamp?: number;
  gufi?: string;
  callsign?: string;
  origin?: string;
  dest?: string;
  routeText?: string;
  acType?: string;
  etd?: number;
  atd?: number;
  eta?: number;
  ata?: number;
  fdpsStatus?: string; // PROPOSED | ACTIVE | COMPLETED | CANCELLED | DROPPED
}

// Only the root element is namespaced and its prefix varies between payloads, so prefixes are stripped.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (_name, jpath) => jpath === 'MessageCollection.message',
});

type Node = Record<string, unknown>;

function at(node: unknown, path: string): unknown {
  let cur = node;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Node)[key];
  }
  return cur;
}

function str(node: unknown, path: string): string | undefined {
  const v = at(node, path);
  const s = typeof v === 'object' && v !== null ? (v as Node)['#text'] : v;
  return typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
}

function time(node: unknown, path: string): number | undefined {
  const s = str(node, path);
  const t = s === undefined ? NaN : Date.parse(s);
  return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
}

function toFlight(f: Node): SfdpsFlight | undefined {
  const source = str(f, '@source');
  if (!source) return undefined;
  const out: SfdpsFlight = { source };
  const set = <K extends keyof SfdpsFlight>(k: K, v: SfdpsFlight[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set('centre', str(f, '@centre'));
  set('timestamp', time(f, '@timestamp'));
  set('gufi', str(f, 'gufi'));
  set('callsign', str(f, 'flightIdentification.@aircraftIdentification'));
  set('origin', str(f, 'departure.@departurePoint'));
  set('dest', str(f, 'arrival.@arrivalPoint'));
  set('routeText', str(f, 'agreed.route.@nasRouteText'));
  set('acType', str(f, 'aircraftDescription.aircraftType.icaoModelIdentifier'));
  const proposed = str(f, 'coordination.@coordinationTimeHandling') === 'P' ? time(f, 'coordination.@coordinationTime') : undefined;
  set('etd', time(f, 'departure.runwayPositionAndTime.runwayTime.estimated.@time') ?? proposed);
  set('atd', time(f, 'departure.runwayPositionAndTime.runwayTime.actual.@time'));
  set('eta', time(f, 'arrival.runwayPositionAndTime.runwayTime.estimated.@time'));
  set('ata', time(f, 'arrival.runwayPositionAndTime.runwayTime.actual.@time'));
  set('fdpsStatus', str(f, 'flightStatus.@fdpsFlightStatus'));
  return out;
}

/** Every `flight` in an SFDPS FIXM payload: a `MessageCollection`, or a single (older) `NasFlight`. */
export function parseSfdps(xml: string): SfdpsFlight[] {
  const doc = parser.parse(xml) as Node;
  if (doc.MessageCollection !== undefined) {
    const messages = (at(doc, 'MessageCollection.message') as Node[] | undefined) ?? [];
    return messages.map((m) => (m.flight && typeof m.flight === 'object' ? toFlight(m.flight as Node) : undefined)).filter((f): f is SfdpsFlight => f !== undefined);
  }
  if (doc.NasFlight !== undefined && typeof doc.NasFlight === 'object') {
    const f = toFlight(doc.NasFlight as Node);
    return f ? [f] : [];
  }
  throw new Error('not an SFDPS FIXM payload (no MessageCollection or NasFlight root)');
}
