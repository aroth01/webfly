import type { FlightView, LiveState, NavTile, Trail } from '../../shared/types.ts';
import type { DataSource } from './source.ts';
import type { TileId } from './nd/tiles.ts';

// A DFW -> LAX flight over west Texas, for developing and screenshotting the ND without the API.
export const FIXTURE_FLIGHT: FlightView = {
  query: 'AA558',
  callsign: 'AAL558',
  gufi: 'fixture',
  operator: 'American Airlines',
  acType: 'A321',
  origin: { icao: 'KDFW', name: 'DALLAS-FORT WORTH INTL', lat: 32.897, lon: -97.038 },
  dest: { icao: 'KLAX', name: 'LOS ANGELES INTL', lat: 33.942, lon: -118.408 },
  status: 'active',
  etd: Math.floor(Date.now() / 1000) - 5400,
  atd: Math.floor(Date.now() / 1000) - 5100,
  route: {
    source: 'filed',
    partial: false,
    amendedAt: Math.floor(Date.now() / 1000) - 1800,
    text: 'KDFW WINDU ABI SPUDS MAF GONZO ELP TUS BLH PRADO KLAX',
    points: [
      { ident: 'KDFW', lat: 32.897, lon: -97.038, kind: 'airport' },
      { ident: 'WINDU', lat: 32.7, lon: -98.6, kind: 'fix', via: 'DFW4' },
      { ident: 'ABI', lat: 32.48, lon: -99.85, kind: 'navaid', via: 'J4' },
      { ident: 'SPUDS', lat: 32.2, lon: -101.3, kind: 'fix', via: 'J4' },
      { ident: 'MAF', lat: 31.95, lon: -102.2, kind: 'navaid', via: 'J4' },
      { ident: 'GONZO', lat: 31.9, lon: -104.0, kind: 'fix', via: 'J4' },
      { ident: 'ELP', lat: 31.81, lon: -106.28, kind: 'navaid', via: 'J4' },
      { ident: 'TUS', lat: 32.09, lon: -110.9, kind: 'navaid' },
      { ident: 'BLH', lat: 33.6, lon: -114.7, kind: 'navaid' },
      { ident: 'PRADO', lat: 33.9, lon: -116.9, kind: 'fix' },
      { ident: 'KLAX', lat: 33.942, lon: -118.408, kind: 'airport' },
    ],
  },
  hex: 'a114f4',
  navCycle: '2610',
};

export const FIXTURE_LIVE: LiveState = {
  t: 0,
  aircraft: {
    hex: 'a114f4',
    lat: 32.34,
    lon: -100.7,
    altBaro: 35000,
    gs: 452,
    track: 262,
    vs: 0,
    tas: 478,
    trueHeading: 259,
    windDir: 285,
    windSpd: 38,
    onGround: false,
    ageSec: 1,
  },
  traffic: [
    { hex: 't1', callsign: 'SWA1432', lat: 32.5, lon: -100.2, alt: 36000, track: 80, vs: 0 },
    { hex: 't2', callsign: 'UAL220', lat: 32.1, lon: -101.1, alt: 34200, track: 255, vs: 900 },
    { hex: 't3', callsign: 'N172SP', lat: 32.6, lon: -101.5, alt: 8500, track: 10, vs: -600 },
    { hex: 't4', callsign: 'DAL88', lat: 32.35, lon: -100.55, alt: 35500, track: 90, vs: 0 },
  ],
};

export const FIXTURE_TRAIL: Trail = Array.from({ length: 60 }, (_, i): Trail[number] => {
  const f = i / 59; // from DFW toward the aircraft
  return [i * 60, 32.897 + (32.34 - 32.897) * f, -97.038 + (-100.7 + 97.038) * f, 1000 + 34000 * Math.min(1, f * 4)];
});

const FIXTURE_NAVAIDS = [
  { ident: 'ABI', type: 'VORTAC', lat: 32.48, lon: -99.85 },
  { ident: 'MAF', type: 'VOR/DME', lat: 31.95, lon: -102.2 },
  { ident: 'SJT', type: 'VORTAC', lat: 31.37, lon: -100.45 },
  { ident: 'LBB', type: 'VORTAC', lat: 33.7, lon: -101.9 },
  { ident: 'BGS', type: 'VORTAC', lat: 32.38, lon: -101.5 },
  { ident: 'OD', type: 'NDB', lat: 31.9, lon: -102.37 },
  { ident: 'SWW', type: 'DME', lat: 32.46, lon: -100.5 },
];
const FIXTURE_AIRPORTS = [
  { icao: 'KABI', lat: 32.41, lon: -99.68 },
  { icao: 'KSJT', lat: 31.36, lon: -100.5 },
  { icao: 'KMAF', lat: 31.94, lon: -102.2 },
  { icao: 'KBPG', lat: 32.21, lon: -101.52 },
  { icao: 'KLBB', lat: 33.66, lon: -101.82 },
];

export function fixtureTile(t: TileId): NavTile {
  const inCell = (p: { lat: number; lon: number }) => p.lat >= t.lat0 && p.lat < t.lat0 + 2 && p.lon >= t.lon0 && p.lon < t.lon0 + 2;
  return { cycle: '2610', navaids: FIXTURE_NAVAIDS.filter(inCell), airports: FIXTURE_AIRPORTS.filter(inCell) };
}

export const fixtureSource: DataSource = {
  flight: async () => ({ ok: true, data: FIXTURE_FLIGHT }),
  live: async () => ({ ok: true, data: { ...FIXTURE_LIVE, t: Date.now() } }),
  trail: async () => ({ ok: true, data: FIXTURE_TRAIL }),
  tile: async (_cycle, t) => ({ ok: true, data: fixtureTile(t) }),
};
