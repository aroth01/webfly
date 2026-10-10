import { join } from 'node:path';
import type { ScdsConfig } from './swim/solace.ts';

export interface Config {
  port: number;
  dataDir: string; // persistent state: flights.db, nasr/ (a Fly volume in production)
  flightsDb: string;
  navDirs: string[]; // searched for the newest nasr-YYYY-MM-DD.json.gz
  swimEnabled: boolean;
  scds: ScdsConfig | undefined; // set when every SCDS_* variable is present
  missingScds: string[];
  swimRecordDir: string | undefined; // write kept SWIM payloads here, for replay
  userAgent: string; // sent to adsb.lol with a contact URL (spec §6.4)
  onFly: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = env.DATA_DIR ?? 'data';
  const contact = env.CONTACT_URL ?? 'https://github.com/aroth01/webfly';
  const scdsVars = ['SCDS_URL', 'SCDS_VPN', 'SCDS_USERNAME', 'SCDS_PASSWORD', 'SCDS_QUEUE'] as const;
  const missingScds = scdsVars.filter((k) => !env[k]);
  const scds: ScdsConfig | undefined =
    missingScds.length === 0
      ? { url: env.SCDS_URL!, vpn: env.SCDS_VPN!, username: env.SCDS_USERNAME!, password: env.SCDS_PASSWORD!, queue: env.SCDS_QUEUE! }
      : undefined;
  return {
    port: Number(env.PORT ?? 8080),
    dataDir,
    flightsDb: env.FLIGHTS_DB ?? join(dataDir, 'flights.db'),
    navDirs: [...new Set([join(dataDir, 'nasr'), dataDir, 'data'])],
    swimEnabled: env.SWIM_ENABLED === 'true',
    scds,
    missingScds,
    swimRecordDir: env.SWIM_RECORD_DIR || undefined,
    userAgent: `WebFly/0.1 (+${contact})`,
    onFly: Boolean(env.FLY_APP_NAME),
  };
}
