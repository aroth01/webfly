import { join } from 'node:path';

export interface Config {
  port: number;
  dataDir: string; // persistent state: flights.db, nasr/ (a Fly volume in production)
  flightsDb: string;
  navDirs: string[]; // searched for the newest nasr-YYYY-MM-DD.json.gz
  swimEnabled: boolean;
  userAgent: string; // sent to adsb.lol with a contact URL (spec §6.4)
  onFly: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = env.DATA_DIR ?? 'data';
  const contact = env.CONTACT_URL ?? 'https://github.com/aroth01/webfly';
  return {
    port: Number(env.PORT ?? 8080),
    dataDir,
    flightsDb: env.FLIGHTS_DB ?? join(dataDir, 'flights.db'),
    navDirs: [...new Set([join(dataDir, 'nasr'), dataDir, 'data'])],
    swimEnabled: env.SWIM_ENABLED === 'true',
    userAgent: `WebFly/0.1 (+${contact})`,
    onFly: Boolean(env.FLY_APP_NAME),
  };
}
