import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Serve the built SPA from `root` (web/dist): hashed assets cached forever, everything else
 * revalidated, and any other GET answered with index.html so deep links like /f/AA558 work.
 */
export function mountSpa(app: Hono, root: string): boolean {
  const indexPath = join(root, 'index.html');
  if (!existsSync(indexPath)) return false;
  const index = readFileSync(indexPath, 'utf8');
  app.use('/assets/*', async (c, next) => {
    await next();
    if (c.res.status === 200) c.header('Cache-Control', 'public, max-age=31536000, immutable');
  });
  app.use('*', async (c, next) => {
    await next();
    if (c.res.status === 200 && !c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-cache');
  });
  app.use('*', serveStatic({ root }));
  app.get('*', (c) => c.html(index));
  return true;
}
