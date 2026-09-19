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

  await page.route('**tile.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
  await page.route('**api.open-meteo.com/**', (route) => route.fulfill(json(makeWeatherPayload(HOME))));
  await page.route('**overpass**', (route) => route.fulfill(json(makeOverpassPayload(HOME))));
  await page.route('**nominatim.openstreetmap.org/search**', (route) => route.fulfill(json(makeGeocodePayload())));
  await page.route('**nominatim.openstreetmap.org/reverse**', (route) =>
    route.fulfill(json({ name: 'Tampere', address: { city: 'Tampere', county: 'Pirkanmaa' } })));
}

/** PWA files must be servable and consistent, or an install silently fails. */
async function checkPwaAssets() {
  const manifestResponse = await fetch(`http://localhost:${PORT}/manifest.webmanifest`);
  assert.equal(manifestResponse.status, 200, 'manifest must be served');
  const manifest = await manifestResponse.json();
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.name && manifest.short_name);
  for (const icon of manifest.icons) {
    const iconResponse = await fetch(new URL(icon.src, `http://localhost:${PORT}/`));
    assert.equal(iconResponse.status, 200, `icon missing: ${icon.src}`);
    assert.ok(iconResponse.headers.get('content-type').startsWith('image/'));
  }
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'), 'a maskable icon is required');

  const swResponse = await fetch(`http://localhost:${PORT}/sw.js`);
  assert.equal(swResponse.status, 200, 'service worker must be served');
  const sw = await swResponse.text();
  assert.ok(sw.includes("addEventListener('fetch'"), 'service worker must handle fetch');

  const appleIcon = await fetch(`http://localhost:${PORT}/assets/icons/apple-touch-icon.png`);
  assert.equal(appleIcon.status, 200, 'iOS needs an apple-touch-icon');
}

/** Real touch swipe through CDP: page.touchscreen only offers taps. */
async function swipe(page, { x, fromY, toY, steps = 10 }) {
  const cdp = await page.context().newCDPSession(page);
  const point = (y) => [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(fromY) });
  for (let i = 1; i <= steps; i += 1) {
    const y = fromY + ((toY - fromY) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(y) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Wait for momentum scrolling to stop, then pin the list to the top. */
async function settleScrollTop(page, selector) {
  await page.waitForFunction((sel) => {
    const node = document.querySelector(sel);
    const previous = node.dataset.lastScroll;
    node.dataset.lastScroll = String(node.scrollTop);
    return previous === String(node.scrollTop);
  }, selector, { polling: 120, timeout: 5000 });
  await page.evaluate((sel) => document.querySelector(sel).scrollTo(0, 0), selector);
  await page.waitForTimeout(200);
  return page.evaluate((sel) => document.querySelector(sel).scrollTop, selector);
}

/** Tap the handle until the sheet rests at the wanted snap. */
async function snapTo(page, wanted) {
  for (let i = 0; i < 4; i += 1) {
    if (await page.locator('#panel').getAttribute('data-snap') === wanted) return;
    await page.tap('#sheet-handle');
    await page.waitForTimeout(400);
  }
  throw new Error(`could not reach snap "${wanted}"`);
}

/** Phone run: touch input, the bottom sheet and tap-target sizes. */
async function mobileRun(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },       // iPhone 13 class
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: 'fi-FI',
    permissions: ['geolocation'],
    geolocation: { latitude: HOME.lat, longitude: HOME.lon },
    serviceWorkers: 'block',                     // keep the stubs authoritative
  });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });

  await stubNetwork(page);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#spots-list .card', { timeout: 15000 });

  // The sheet starts as a peek strip over a full-bleed map.
  const panel = page.locator('#panel');
  assert.equal(await panel.getAttribute('data-snap'), 'peek');
  const peekVisible = await page.evaluate(() =>
    innerHeight - document.querySelector('#panel').getBoundingClientRect().top);
  assert.ok(peekVisible > 120 && peekVisible < 230, `peek height looks wrong: ${peekVisible}px`);

  const mapBox = await page.locator('#map').boundingBox();
  assert.ok(mapBox.height > 500, `map should fill the screen, got ${mapBox.height}px`);
  await page.screenshot({ path: join(SHOTS, 'm1-kartta.png') });

  // Tapping the handle lifts it; tapping again opens it fully.
  await page.tap('#sheet-handle');
  await page.waitForTimeout(400);
  assert.equal(await panel.getAttribute('data-snap'), 'half');
  const halfVisible = await page.evaluate(() =>
    innerHeight - document.querySelector('#panel').getBoundingClientRect().top);
  assert.ok(halfVisible > peekVisible + 100, `half should be taller than peek (${halfVisible} vs ${peekVisible})`);

  await page.tap('#sheet-handle');
  await page.waitForTimeout(400);
  assert.equal(await panel.getAttribute('data-snap'), 'full');

  // Dragging the handle down snaps back towards the smaller stops.
  const handleBox = await page.locator('#sheet-handle').boundingBox();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 6);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 300, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(450);
  assert.notEqual(await panel.getAttribute('data-snap'), 'full', 'dragging down should collapse the sheet');

  // Every interactive control must be thumb-sized.
  const small = await page.evaluate(() => {
    const selectors = '#locate-fab, .tab, .btn:not([hidden]), .card, #radius-select, .sheet-handle';
    return [...document.querySelectorAll(selectors)]
      .filter((node) => node.offsetParent !== null)
      .map((node) => ({ id: node.id || node.className, box: node.getBoundingClientRect() }))
      .filter(({ box }) => box.height > 0 && box.height < 44)
      .map(({ id, box }) => `${id}: ${Math.round(box.height)}px`);
  });
  assert.equal(small.length, 0, `tap targets under 44px: ${small.join(', ')}`);

  // The locate action sits in the thumb zone, above the sheet, not in the header.
  await snapTo(page, 'peek');
  const fab = await page.locator('#locate-fab').boundingBox();
  const sheetTop = await page.evaluate(() => document.querySelector('#panel').getBoundingClientRect().top);
  assert.ok(fab.y > 844 * 0.5, 'the locate button must be reachable by thumb');
  assert.ok(fab.y + fab.height <= sheetTop + 1, 'the locate button must not hide behind the sheet');
  assert.ok(fab.width >= 44 && fab.height >= 44, 'the FAB must be a full tap target');
  assert.ok(await page.locator('#locate-btn').isHidden(), 'the header button is replaced on phones');

  // OpenStreetMap attribution has to stay visible above the sheet.
  const attribution = await page.locator('.leaflet-control-attribution').boundingBox();
  assert.ok(attribution.y + attribution.height <= sheetTop + 2, 'attribution must stay visible');

  // Picking a spot lifts the sheet and shows the species for it.
  await snapTo(page, 'half');
  await page.locator('#spots-list .card').first().tap();
  await page.waitForSelector('#species-list .card', { timeout: 10000 });
  assert.notEqual(await panel.getAttribute('data-snap'), 'peek', 'selecting a spot should open the sheet');
  await page.screenshot({ path: join(SHOTS, 'm2-kalat.png') });

  // The chart responds to a tap, not just to a mouse hover.
  await page.tap('#tab-weather');
  await page.waitForSelector('#view-weather .chart-card');
  await page.locator('#view-weather .chart-card').scrollIntoViewIfNeeded();
  const before = await page.textContent('#view-weather .chart-readout b');
  const chart = await page.locator('#view-weather .chart-wrap svg').boundingBox();
  await page.touchscreen.tap(chart.x + chart.width * 0.75, chart.y + chart.height * 0.5);
  await page.waitForTimeout(250);
  const after = await page.textContent('#view-weather .chart-readout b');
  assert.notEqual(before, after, 'tapping the chart should select that hour');
  await page.screenshot({ path: join(SHOTS, 'm3-kalasaa.png') });

  // A swipe inside the list must scroll the content, not drag the sheet away.
  await snapTo(page, 'full');
  await settleScrollTop(page, '#view-weather');
  await swipe(page, { x: 195, fromY: 700, toY: 380 });
  await page.waitForTimeout(500);
  const scrolled = await page.evaluate(() => document.querySelector('#view-weather').scrollTop);
  assert.ok(scrolled > 60, `swiping inside the sheet should scroll it, got ${scrolled}px`);
  assert.equal(await panel.getAttribute('data-snap'), 'full', 'scrolling must not move the sheet');

  // Pulling down from the top of the list closes the sheet instead.
  const restingTop = await settleScrollTop(page, '#view-weather');
  assert.equal(restingTop, 0, 'the list must be at the top before the pull-down gesture');
  const contentTop = await page.evaluate(() =>
    Math.round(document.querySelector('#view-weather').getBoundingClientRect().top));
  await swipe(page, { x: 195, fromY: contentTop + 40, toY: contentTop + 420 });
  await page.waitForTimeout(600);
  const afterPull = await panel.getAttribute('data-snap');
  assert.notEqual(afterPull, 'full',
    `pulling down at the top should lower the sheet (content top ${contentTop}px, snap ${afterPull})`);

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `horizontal overflow on the phone layout: ${overflow}px`);

  // Landscape: the sheet docks to the side instead of covering the map.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(400);
  const docked = await page.evaluate(() => {
    const box = document.querySelector('#panel').getBoundingClientRect();
    return { top: Math.round(box.top), width: Math.round(box.width) };
  });
  assert.ok(docked.width < 844 * 0.6, `side panel too wide in landscape: ${docked.width}px`);
  await page.screenshot({ path: join(SHOTS, 'm4-vaaka.png') });

  await context.close();
  return problems;
}

/** The service worker must serve the shell when the network is gone. */
async function offlineRun(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'fi-FI',
    serviceWorkers: 'allow',
  });
  const page = await context.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });

  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15000 });
  await page.waitForTimeout(1500);                       // let the shell finish precaching

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.waitForSelector('#map', { timeout: 10000 });
  assert.ok(await page.locator('.app-header').isVisible(), 'the shell must load from the cache offline');
  assert.ok(await page.locator('#tab-spots').isVisible(), 'the panel must render offline');
  assert.ok(await page.locator('#offline-banner').isVisible(), 'the offline state must be visible to the user');
  const leafletLoaded = await page.evaluate(() => typeof window.L === 'object');
  assert.ok(leafletLoaded, 'the map library must come from the cache, not a CDN');

  await context.setOffline(false);
  await context.close();
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
      // The service worker is verified separately; blocking it here keeps the
      // stubbed responses authoritative instead of racing with a cache.
      serviceWorkers: 'block',
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

    await context.close();

    await checkPwaAssets();
    failures.push(...await mobileRun(browser));
    await offlineRun(browser);
  } finally {
    if (failures.length) console.error('Selainvirheet:\n' + failures.join('\n'));
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
