// ND visual regression (spec §11): fixture API responses, a frozen clock, a 390×844 viewport.
// Fixtures come from scripts/make-e2e-fixtures.ts; update baselines with `npm run test:visual -- --update-snapshots`.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { NavTile } from '../../shared/types.ts';

const FIXTURE_TIME = Date.UTC(2026, 9, 10, 18, 0, 0); // must match scripts/make-e2e-fixtures.ts
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const { cycle, tiles } = fixture('tiles.json') as { cycle: string; tiles: Record<string, NavTile> };

async function mockApi(page: Page, live: Record<string, unknown> = {}) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    let m: RegExpExecArray | null;
    if ((m = /^\/api\/flight\/(\w+)$/.exec(path))) {
      if (m[1] === 'UA5000') return json(fixture('choices-UA5000.json'));
      if (m[1] === 'AA558' || m[1] === 'DL1234') return json(fixture(`flight-${m[1]}.json`));
      return json({ error: { code: 'not_found', message: `No flight ${m[1]} found today. Try the operating carrier's code.` } }, 404);
    }
    if ((m = /^\/api\/live\/(\w+)$/.exec(path))) {
      const base = m[1] === 'AAL558' ? (fixture('live-AAL558.json') as object) : { t: FIXTURE_TIME, aircraft: null, traffic: [] };
      return json({ ...base, ...live });
    }
    if (path.startsWith('/api/trail/')) return json(fixture('trail-AAL558.json'));
    if ((m = /^\/api\/nav\/(\w+)\/(-?\d+)\/(-?\d+)$/.exec(path))) {
      return json(tiles[`${m[2]}/${m[3]}`] ?? { cycle, navaids: [], airports: [] });
    }
    return json({ error: { code: 'not_found', message: 'No such endpoint.' } }, 404);
  });
}

/**
 * Open a page with time paused at the fixture instant. Timers and animation frames then advance only
 * through `settle`, so dead reckoning, easing and polling are identical on every run.
 */
async function open(page: Page, path: string) {
  await page.clock.install({ time: FIXTURE_TIME - 1_000 });
  await page.clock.pauseAt(FIXTURE_TIME);
  await page.goto(path);
  await page.evaluate(async () => {
    await document.fonts.load('16px "B612 Mono"');
    await document.fonts.load('16px "B612"');
    await document.fonts.ready;
  });
}

/** Let requests finish (real time) and the ND run for `ms` of fake time. */
async function settle(page: Page, ms = 3_000) {
  for (let elapsed = 0; elapsed < ms; elapsed += 500) {
    await page.clock.runFor(500);
    await page.waitForLoadState('networkidle');
  }
}

test('input screen', async ({ page }) => {
  await open(page, '/');
  await expect(page.getByLabel('FLT NBR')).toBeVisible();
  await expect(page).toHaveScreenshot('input.png');
});

test('input screen rejects a malformed flight number without a request', async ({ page }) => {
  await mockApi(page);
  await open(page, '/');
  await page.getByLabel('FLT NBR').fill('HELLO');
  await page.getByRole('button', { name: 'GO' }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter an airline code and flight number, like AA558.');
  await expect(page).toHaveURL('/');
});

test('pick list', async ({ page }) => {
  await mockApi(page);
  await open(page, '/f/UA5000');
  await settle(page, 500);
  await expect(page.getByText('UA5000: SELECT FLIGHT')).toBeVisible();
  await expect(page).toHaveScreenshot('pick-list.png');
});

test('ND at 80 nm', async ({ page }) => {
  await mockApi(page);
  await open(page, '/f/AA558');
  await settle(page);
  await expect(page.locator('.strip-alt')).toHaveText('FL350');
  await expect(page).toHaveScreenshot('nd-80nm.png');
});

test('ND at 20 nm', async ({ page }) => {
  await mockApi(page);
  await open(page, '/f/AA558');
  await settle(page, 1_000);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await settle(page);
  await expect(page.locator('.range-value')).toHaveText('20 NM');
  await expect(page).toHaveScreenshot('nd-20nm.png');
});

test('ND with a stale position', async ({ page }) => {
  await mockApi(page);
  await page.route('**/api/live/AAL558', async (route) => {
    const live = fixture('live-AAL558.json') as { aircraft: Record<string, unknown> };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...live, aircraft: { ...live.aircraft, ageSec: 45 } }) });
  });
  await open(page, '/f/AA558');
  await settle(page);
  await expect(page).toHaveScreenshot('nd-stale.png');
});

test('ND without a position', async ({ page }) => {
  await mockApi(page);
  await open(page, '/f/DL1234');
  await settle(page);
  await expect(page.locator('.strip-status')).toHaveText('ETD 19:37Z');
  await expect(page).toHaveScreenshot('nd-no-position.png');
});

test('ND in landscape', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await mockApi(page);
  await open(page, '/f/AA558');
  await settle(page);
  await expect(page).toHaveScreenshot('nd-landscape.png');
});

test('flight not found', async ({ page }) => {
  await mockApi(page);
  await open(page, '/f/AA9');
  await settle(page, 500);
  await expect(page.getByRole('status')).toHaveText("No flight AA9 found today. Try the operating carrier's code.");
});
