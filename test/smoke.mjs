/**
 * Browser smoke test.
 *
 * Serves the app locally and answers every outbound request with the fixtures
 * in test/fixtures.mjs, so the run is deterministic and needs no network.
 * Checks the three views render and writes screenshots to test/screenshots/.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

import { chromium } from 'playwright';
import { makeWeatherPayload, makeOverpassPayload, makeGeocodePayload } from './fixtures.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = join(ROOT, 'test', 'screenshots');
const PORT = 5199;
const HOME = { lat: 61.4978, lon: 23.761 };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function startServer() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const file = join(ROOT, path === '/' ? 'index.html' : path);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

async function stubNetwork(page) {
  const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**unpkg.com/leaflet**', async (route) => {
    const isCss = route.request().url().endsWith('.css');
    const file = join(ROOT, 'node_modules/leaflet/dist', isCss ? 'leaflet.css' : 'leaflet.js');
    await route.fulfill({
      status: 200,
      contentType: isCss ? 'text/css' : 'text/javascript',
      body: await readFile(file, 'utf8'),
    });
  });
  await page.route('**tile.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
  await page.route('**api.open-meteo.com/**', (route) => route.fulfill(json(makeWeatherPayload(HOME))));
  await page.route('**overpass**', (route) => route.fulfill(json(makeOverpassPayload(HOME))));
  await page.route('**nominatim.openstreetmap.org/search**', (route) => route.fulfill(json(makeGeocodePayload())));
  await page.route('**nominatim.openstreetmap.org/reverse**', (route) =>
    route.fulfill(json({ name: 'Tampere', address: { city: 'Tampere', county: 'Pirkanmaa' } })));
}

async function run() {
  if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });
  const server = await startServer();
  // The container ships a pinned Chromium; use it instead of downloading one.
  const executablePath = process.env.CHROMIUM_PATH
    || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((candidate) => existsSync(candidate));
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const failures = [];

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 860 },
      locale: 'fi-FI',
      permissions: ['geolocation'],
      geolocation: { latitude: HOME.lat, longitude: HOME.lon },
      colorScheme: 'light',
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') failures.push(`console: ${message.text()}`);
    });

    await stubNetwork(page);
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });

    // --- spots -----------------------------------------------------------
    await page.waitForSelector('#spots-list .card', { timeout: 15000 });
    const spotTitles = await page.$$eval('#spots-list .card-title', (nodes) => nodes.map((n) => n.textContent));
    assert.ok(spotTitles.includes('Kaupin kalastuslaituri'), `spots missing: ${spotTitles}`);
    assert.ok(spotTitles.includes('Näsijärvi'));
    const pins = await page.$$eval('.pin', (nodes) => nodes.length);
    assert.ok(pins >= 4, `expected markers on the map, got ${pins}`);
    await page.screenshot({ path: join(SHOTS, '1-paikat.png'), fullPage: false });

    // --- species (selecting a spot switches to the species tab) ----------
    await page.click('#spots-list .card');
    await page.waitForSelector('#species-list .card', { timeout: 10000 });
    const species = await page.$$eval('#species-list .card-title', (nodes) => nodes.map((n) => n.textContent.trim()));
    assert.ok(species.length >= 4, `expected several species, got ${species.length}`);
    assert.ok(species[0].startsWith('Ahven'), `unexpected first species: ${species[0]}`);
    await page.screenshot({ path: join(SHOTS, '2-kalat.png') });

    // --- weather ---------------------------------------------------------
    await page.click('#tab-weather');
    await page.waitForSelector('#view-weather .hero-value', { timeout: 10000 });
    const heroScore = Number(await page.textContent('#view-weather .hero-value'));
    assert.ok(heroScore >= 0 && heroScore <= 100, `hero score out of range: ${heroScore}`);

    const columns = await page.$$eval('#view-weather .chart-wrap path[data-index]', (nodes) => nodes.length);
    assert.equal(columns, 48, `expected 48 hourly columns, got ${columns}`);

    const windows = await page.$$eval('#view-weather .window-time', (nodes) => nodes.map((n) => n.textContent));
    assert.ok(windows.length >= 1, 'expected at least one best window');
    assert.ok(/klo \d\d\.\d\d–\d\d\.\d\d/.test(windows[0]), `unexpected window label: ${windows[0]}`);

    const factorCount = await page.$$eval('#view-weather .factors li', (nodes) => nodes.length);
    assert.ok(factorCount >= 4, `expected the score breakdown, got ${factorCount} rows`);
    await page.screenshot({ path: join(SHOTS, '3-kalasaa.png') });
    await page.locator('#view-weather .chart-card').scrollIntoViewIfNeeded();
    await page.locator('#view-weather').screenshot({ path: join(SHOTS, '6-kuvaaja.png') });

    // keyboard navigation moves the selected hour
    const before = await page.textContent('#view-weather .chart-readout b');
    await page.focus('#view-weather .chart-card');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const after = await page.textContent('#view-weather .chart-readout b');
    assert.notEqual(before, after, 'arrow keys should move the selected hour');

    // table view is available as the accessible fallback
    await page.click('#view-weather .chart-foot .btn');
    const rows = await page.$$eval('#view-weather table.data tbody tr', (nodes) => nodes.length);
    assert.equal(rows, 48, `expected 48 table rows, got ${rows}`);

    // --- target species re-scores the forecast ---------------------------
    await page.click('#tab-species');
    const cards = await page.$$('#species-list .card');
    await cards[0].click();
    await page.waitForSelector('#view-weather .hero-value');
    const speciesScore = Number(await page.textContent('#view-weather .hero-value'));
    assert.ok(Number.isFinite(speciesScore));

    // --- dark mode and mobile layout ------------------------------------
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: join(SHOTS, '4-tumma.png') });

    await page.setViewportSize({ width: 414, height: 900 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.click('#tab-weather');
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOTS, '5-mobiili.png'), fullPage: false });

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `horizontal overflow on mobile: ${overflow}px`);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length) {
    throw new Error(`Browser reported errors:\n${failures.join('\n')}`);
  }
  console.log('Selaintesti läpi. Kuvakaappaukset: test/screenshots/');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
