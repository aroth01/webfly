import { existsSync } from 'node:fs';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';

/**
 * Serve the built SPA from `dir` (relative to the working directory), with `index.html` as the fallback for
 * client-side routes like /f/AA558. Hashed assets are immutable; the HTML must always be revalidated.
 * Does nothing when the directory does not exist (API-only development).
 */
export function mountStatic(app: Hono, dir: string): boolean {
  if (!existsSync(dir)) return false;
  app.use('/assets/*', async (c, next) => {
    await next();
    if (c.res.status === 200) c.res.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  });
  app.use('/*', serveStatic({ root: dir }));
  app.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api/')) return next();
    c.header('Cache-Control', 'no-cache');
    return serveStatic({ root: dir, path: 'index.html' })(c, next);
  });
  return true;
}
