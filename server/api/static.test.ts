import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { mountSpa } from './static.ts';

function site() {
  const root = mkdtempSync(join(tmpdir(), 'webfly-spa-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>WebFly</title>');
  writeFileSync(join(root, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(root, 'favicon.svg'), '<svg/>');
  const app = new Hono();
  app.get('/api/health', (c) => c.json({ ok: true }));
  expect(mountSpa(app, root)).toBe(true);
  return app;
}

describe('mountSpa', () => {
  it('serves hashed assets as immutable and other files with revalidation', async () => {
    const app = site();
    const js = await app.request('/assets/index-abc123.js');
    expect(js.status).toBe(200);
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect((await app.request('/favicon.svg')).headers.get('cache-control')).toBe('no-cache');
  });

  it('answers deep links with index.html and leaves API routes alone', async () => {
    const app = site();
    for (const path of ['/', '/f/AA558']) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
      expect(await res.text()).toContain('<title>WebFly</title>');
      expect(res.headers.get('cache-control')).toBe('no-cache');
    }
    expect(await (await app.request('/api/health')).json()).toEqual({ ok: true });
  });

  it('does nothing without a build', () => {
    expect(mountSpa(new Hono(), join(tmpdir(), 'no-such-webfly-build'))).toBe(false);
  });
});
