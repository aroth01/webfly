// Usage: npm run decode -- "KDFW.AKUNA9.MLC..SGF.WELTS.TRTLL6.KORD"
import { findLatestNavData, loadNavDb } from '../navdata/load.ts';
import { decodeRoute } from '../server/route/decode.ts';

const path = findLatestNavData('data');
if (!path) {
  console.error('No nav data found in data/. Run: npm run navdata:build');
  process.exit(1);
}
const db = loadNavDb(path);
const result = decodeRoute(process.argv.slice(2).join(' '), db);
console.log(`NASR cycle ${db.cycle}`);
console.table(
  result.points.map((p) => ({ ident: p.ident, kind: p.kind, via: p.via ?? '', lat: p.lat.toFixed(4), lon: p.lon.toFixed(4) })),
);
if (result.unresolved.length) console.log('unresolved:', result.unresolved.join(' '));
if (result.dropped.length) console.log('dropped (zig-zag guard):', result.dropped.join(' '));
