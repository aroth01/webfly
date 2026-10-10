import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { mountStatic } from './static.ts';

describe('mountStatic', () => {
  const root = mkdtempSync(join(tmpdir(), 'webfly-static-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>spa</title>');
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)');
  const dir = relative(process.cwd(), root); // serveStatic roots are relative to the cwd

  const app = new Hono();
  app.get('/api/ping', (c) => c.json({ ok: true }));
  expect(mountStatic(app, dir)).toBe(true);
  app.all('/api/*', (c) => c.json({ error: 'nf' }, 404));

  it('serves the index, assets with immutable caching, and SPA routes via index.html', async () => {
    expect(await (await app.request('/')).text()).toContain('spa');
    const asset = await app.request('/assets/app.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const spa = await app.request('/f/AA558');
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('spa');
    expect(spa.headers.get('cache-control')).toBe('no-cache');
  });
  it('leaves the API alone', async () => {
    expect(await (await app.request('/api/ping')).json()).toEqual({ ok: true });
    expect((await app.request('/api/nope')).status).toBe(404);
  });
  it('does nothing when the directory is missing', () => {
    expect(mountStatic(new Hono(), 'definitely/not/here')).toBe(false);
  });
});
