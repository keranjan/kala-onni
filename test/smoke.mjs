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
import {
  makeWeatherPayload, makeOverpassPayload, makeGeocodePayload, overpassPartFor, overpassRadiusFor,
} from './fixtures.mjs';

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

async function stubNetwork(page, { failWaterQuery = false, slowWideSearchMs = 0 } = {}) {
  const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**tile.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
  await page.route('**api.open-meteo.com/**', (route) => route.fulfill(json(makeWeatherPayload(HOME))));
  // The app asks in two halves; answer each with its own slice, and optionally
  // let the heavy one fail the way a busy Overpass mirror does.
  await page.route('**overpass**', async (route) => {
    // The body is form-encoded; decode it before deciding which half this is.
    const query = new URLSearchParams(route.request().postData() || '').get('data') || '';
    const part = overpassPartFor(query);
    const radiusKm = overpassRadiusFor(query);
    if (failWaterQuery && part === 'water') {
      return route.fulfill({ status: 504, contentType: 'text/plain', body: 'gateway timeout' });
    }
    // Only the heavy half of a wide search is slow – that is the whole point
    // of splitting it, and the fast half must stay fast.
    if (slowWideSearchMs && part === 'water' && radiusKm >= 10) {
      await new Promise((resolve) => setTimeout(resolve, slowWideSearchMs));
    }
    return route.fulfill(json(makeOverpassPayload({ ...HOME, part, radiusKm })));
  });
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
    const selectors = '#locate-fab, .tab, .btn:not([hidden]), .card, #radius-select, .sheet-handle, .chip';
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

  // The thumb-zone button follows the user; panning hands the map back.
  await page.tap('#locate-fab');
  await page.waitForTimeout(900);
  assert.equal(await page.getAttribute('#locate-fab', 'aria-pressed'), 'true',
    'tapping the button should start following');
  const mapBoxForPan = await page.locator('#map').boundingBox();
  await swipe(page, {
    x: mapBoxForPan.x + mapBoxForPan.width / 2,
    fromY: mapBoxForPan.y + 120,
    toY: mapBoxForPan.y + 320,
  });
  await page.waitForTimeout(700);
  assert.equal(await page.getAttribute('#locate-fab', 'aria-pressed'), 'false',
    'panning must stop the recentring on a phone too');
  assert.ok(await page.locator('#area-search').isVisible(), 'and offer a search of what is shown');
  await page.tap('#locate-fab');            // back to following, and centred
  await page.waitForTimeout(700);

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

/**
 * Narrowing the radius while the wider search is still running must not let
 * the late answer repaint spots from outside the new circle.
 */
async function radiusRaceRun(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    locale: 'fi-FI',
    permissions: ['geolocation'],
    geolocation: { latitude: HOME.lat, longitude: HOME.lon },
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  // Long enough that the "water type still unknown" phase is observable.
  await stubNetwork(page, { slowWideSearchMs: 4000 });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });

  // --- a spot picked before the water search lands must catch up ---------
  // The pier has no water tags of its own, so until the lakes arrive its type
  // is unknown and the estimate is deliberately cautious. Once the water half
  // lands the same selection must sharpen by itself.
  await page.waitForSelector('#spots-list .card-title', { timeout: 20000 });
  await page.locator('#spots-list .card').first().click();
  await page.waitForSelector('#species-list .card', { timeout: 10000 });

  const vagueWarning = await page.locator('#species-intro .warn-line').count();
  const vagueLikelihood = Number((await page.textContent('#species-list .figure-value')).replace(/\D/g, ''));
  assert.equal(vagueWarning, 1, 'an unknown water type must be called out, not hidden');

  await page.waitForFunction(() =>
    document.querySelector('#species-intro').textContent.includes('Järvi'),
    null, { timeout: 20000 });
  const sharpLikelihood = Number((await page.textContent('#species-list .figure-value')).replace(/\D/g, ''));
  assert.ok(sharpLikelihood > vagueLikelihood,
    `the estimate must sharpen once the water type is known (${vagueLikelihood} → ${sharpLikelihood})`);
  assert.equal(await page.locator('#species-intro .warn-line').count(), 0,
    'the warning must go away once the water type is known');

  // --- the numbers explain themselves -----------------------------------
  assert.ok(await page.locator('#species-intro details.explainer').isVisible(),
    'the panel must explain what the two numbers mean');
  const whySummary = await page.textContent('#species-list details.why summary');
  assert.match(whySummary, /Miksi esiintyminen on \d+ %/);
  await page.locator('#species-list details.why summary').first().click();
  const reasons = await page.$$eval('#species-list details.why .factors li', (nodes) => nodes.length);
  assert.ok(reasons >= 4, `the breakdown must name every input, got ${reasons}`);

  // --- the picked spot is marked on the map ------------------------------
  const activeId = await page.getAttribute('.pin.is-active', 'data-id');
  assert.ok(activeId, 'the selected spot must be highlighted on the map');

  // Back to the spot list: picking a spot moved the panel to the species view.
  await page.click('#tab-spots');

  // The 10 km search is slow and is the only one that reaches Kaukajärvi.
  await page.waitForSelector('#spots-list .card', { timeout: 20000 });
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#spots-list .card-title')].some((n) => n.textContent === 'Kaukajärvi'),
    null, { timeout: 20000 });

  // Narrow the search while a fresh wide query is in flight.
  await page.selectOption('#radius-select', '5');
  await page.waitForTimeout(3500);

  const titles = await page.$$eval('#spots-list .card-title', (nodes) => nodes.map((n) => n.textContent));
  assert.ok(!titles.includes('Kaukajärvi'),
    `a spot outside the 5 km radius came back: ${titles.join(', ')}`);

  const distances = await page.$$eval('#spots-list .card-dist', (nodes) =>
    nodes.map((n) => n.textContent.trim()));
  for (const distance of distances) {
    const km = distance.endsWith('km') ? Number(distance.replace(/[^0-9,]/g, '').replace(',', '.')) : 0;
    assert.ok(km <= 5, `list shows ${distance}, outside the chosen 5 km`);
  }

  const pinTitles = await page.$$eval('.leaflet-marker-icon', (nodes) =>
    nodes.map((n) => n.getAttribute('title')));
  assert.ok(!pinTitles.includes('Kaukajärvi'), 'a stale marker stayed on the map');

  // Refreshing must reuse every marker that stays, not rebuild the layer.
  const before = await page.evaluate(() => {
    const pins = [...document.querySelectorAll('.pin')];
    pins.forEach((pin) => { pin.dataset.stamp = 'kept'; });
    return pins.map((pin) => pin.dataset.id);
  });
  assert.ok(before.length >= 3, 'need a few markers to test marker reuse');

  await page.click('#refresh-spots');
  await page.waitForTimeout(2000);

  const after = await page.$$eval('.pin', (nodes) =>
    nodes.map((n) => `${n.dataset.id}:${n.dataset.stamp || 'new'}`));
  assert.ok(await page.locator('.pin.is-active').count() === 1,
    'the highlight must survive a refresh of the markers');
  const recreated = after.filter((mark) => mark.endsWith(':new'));
  assert.equal(recreated.length, 0,
    `unchanged markers were rebuilt and blink: ${recreated.join(', ')}`);
  assert.equal(after.length, before.length, 'the same markers should be on the map');

  await context.close();
}

/** Own places and the catch log: the only data the app cannot fetch again. */
async function journalRun(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'fi-FI',
    permissions: ['geolocation'],
    geolocation: { latitude: HOME.lat, longitude: HOME.lon },
    serviceWorkers: 'block',
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.on('dialog', (dialog) => dialog.accept());
  await stubNetwork(page);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#spots-list .card');

  // --- saving a place of your own ---------------------------------------
  await page.click('#add-place');
  await page.waitForSelector('#place-form .form-card');
  await page.fill('#place-name-input', 'Salainen apaja');
  await page.fill('#place-note-input', 'kivikko 20 m rannasta');
  await page.selectOption('#place-water-input', 'jarvi');
  await page.click('#place-form button[type="submit"]');
  await page.waitForTimeout(400);

  assert.equal(await page.locator('#place-form .form-card').count(), 0, 'the form closes when saved');
  const titles = await page.$$eval('#spots-list .card-title', (nodes) => nodes.map((n) => n.textContent));
  assert.ok(titles.includes('Salainen apaja'), `own place must join the list: ${titles.join(', ')}`);
  assert.equal(await page.locator('.pin[data-category="oma"]').count(), 1, 'and the map');
  assert.ok(await page.locator('#panel-filters .chip[data-category="oma"]').isVisible(),
    'own places get their own filter');

  // --- logging a catch ---------------------------------------------------
  await page.locator('#spots-list .card').first().click();      // the own place is nearest
  await page.waitForTimeout(300);
  await page.click('#log-catch');
  await page.waitForSelector('#catch-form .form-card');
  assert.equal(await page.getAttribute('#tab-journal', 'aria-selected'), 'true',
    'logging opens the journal');

  const conditionsShown = await page.textContent('#catch-form .form-sub');
  assert.match(conditionsShown, /kalaonni \d+/, 'the form shows the conditions it will store');
  assert.match(conditionsShown, /Salainen apaja/, 'and where the catch is being logged');

  await page.selectOption('#catch-species-input', 'ahven');
  await page.fill('#catch-length-input', '28');
  await page.fill('#catch-method-input', 'Jigi');
  await page.click('#catch-form button[type="submit"]');
  await page.waitForTimeout(400);

  const entry = await page.textContent('#journal-content .journal-catch .journal-title');
  assert.match(entry, /Ahven · 28 cm · Jigi/, `unexpected journal entry: ${entry}`);
  const entrySub = await page.textContent('#journal-content .journal-catch .journal-sub');
  assert.match(entrySub, /Salainen apaja/);
  assert.match(entrySub, /kalaonni \d+/, 'the conditions are kept with the catch');
  assert.match(await page.textContent('#journal-content .hero-value'), /^1$/);
  await page.screenshot({ path: join(SHOTS, '9-paivakirja.png') });

  // The spot list now carries the history, which is the point of logging.
  await page.click('#tab-spots');
  await page.waitForTimeout(200);
  const hint = await page.textContent('#spots-list .catch-hint');
  assert.match(hint, /Olet saanut täältä/);
  assert.match(hint, /Ahven ×1/);

  // --- it all survives a reload -----------------------------------------
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#spots-list .card');
  assert.ok((await page.$$eval('#spots-list .card-title', (n) => n.map((x) => x.textContent)))
    .includes('Salainen apaja'), 'own places must survive a reload');
  await page.click('#tab-journal');
  await page.waitForTimeout(200);
  assert.match(await page.textContent('#journal-content .journal-catch .journal-title'), /Ahven/,
    'the catch log must survive a reload');

  // --- a backup can be taken --------------------------------------------
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#journal-content .stat-row .btn-ghost'),
  ]);
  assert.match(download.suggestedFilename(), /^kala-onni-\d{4}-\d{2}-\d{2}\.json$/);

  // --- removing entries --------------------------------------------------
  await page.click('#journal-content .journal-place .journal-remove');
  await page.waitForTimeout(300);
  await page.click('#journal-content .journal-catch .journal-remove');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#journal-content .journal-entry').count(), 0,
    'both entries are gone');
  assert.equal(await page.locator('.pin[data-category="oma"]').count(), 0,
    'and the place left the map');

  await context.close();
}

/** Following the user's position while they browse the map. */
async function followRun(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    locale: 'fi-FI',
    permissions: ['geolocation'],
    geolocation: { latitude: HOME.lat, longitude: HOME.lon },
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await stubNetwork(page);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#spots-list .card');

  const centreOf = async (selector) => {
    const box = await page.locator(selector).first().boundingBox();
    return box && { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const away = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // On a wide screen the control lives in the header; the phone has the FAB.
  assert.ok(await page.locator('#locate-fab').isHidden(), 'the floating button is for phones');
  const fab = page.locator('#locate-btn');
  assert.equal(await fab.getAttribute('aria-pressed'), 'false');

  await fab.click();
  await page.waitForTimeout(700);
  assert.equal(await fab.getAttribute('aria-pressed'), 'true', 'the button must show that it is following');

  const mapCentre = await centreOf('#map');
  let dot = await centreOf('.me-dot');
  assert.ok(away(dot, mapCentre) < 60, `the map should centre on the user, off by ${Math.round(away(dot, mapCentre))}px`);

  // Walking: a new fix moves the dot, keeps it centred, and re-measures the list.
  const distanceBefore = await page.textContent('#spots-list .card-dist');
  await context.setGeolocation({ latitude: HOME.lat + 0.02, longitude: HOME.lon + 0.01 });
  await page.waitForTimeout(900);

  const distanceAfter = await page.textContent('#spots-list .card-dist');
  assert.notEqual(distanceAfter, distanceBefore, 'distances must follow the user');
  dot = await centreOf('.me-dot');
  assert.ok(away(dot, mapCentre) < 60, 'while following, the map keeps the user in the middle');

  // Taking hold of the map stops the recentring and offers a search of what is shown.
  await page.mouse.move(mapCentre.x, mapCentre.y);
  await page.mouse.down();
  await page.mouse.move(mapCentre.x - 260, mapCentre.y - 160, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600);

  assert.equal(await fab.getAttribute('aria-pressed'), 'false', 'panning stops the recentring');
  assert.ok(await fab.evaluate((node) => node.classList.contains('is-adrift')),
    'the button should show that it is still tracking but no longer centring');
  assert.ok(await page.locator('#area-search').isVisible(), 'panning away must offer a new search');
  await page.screenshot({ path: join(SHOTS, '8-seuranta.png') });

  // The dot keeps moving even though the map no longer follows it.
  await context.setGeolocation({ latitude: HOME.lat + 0.03, longitude: HOME.lon + 0.015 });
  await page.waitForTimeout(800);
  dot = await centreOf('.me-dot');
  assert.ok(!dot || away(dot, mapCentre) > 40, 'the map must stay where the user left it');

  // Searching the visible area re-runs the search around it.
  await page.click('#area-search');
  await page.waitForTimeout(1500);
  assert.ok(await page.locator('#area-search').isHidden(), 'the offer goes away once taken');
  assert.ok((await page.$$eval('#spots-list .card', (n) => n.length)) > 0, 'the new area has results');

  // Tapping again recentres; once more stops following altogether.
  await fab.click();
  await page.waitForTimeout(700);
  assert.equal(await fab.getAttribute('aria-pressed'), 'true');
  await fab.click();
  await page.waitForTimeout(300);
  assert.equal(await fab.getAttribute('aria-pressed'), 'false');
  assert.ok(!(await fab.evaluate((node) => node.classList.contains('is-adrift'))),
    'stopping clears the tracking state');

  await context.close();
}

/** Category filters: colour-coded spots the user can switch on and off. */
async function filterRun(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    locale: 'fi-FI',
    permissions: ['geolocation'],
    geolocation: { latitude: HOME.lat, longitude: HOME.lon },
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await stubNetwork(page);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#spots-list .card');

  // Chips appear in both places and agree with what is listed.
  const chips = await page.$$eval('#panel-filters .chip', (nodes) => nodes.map((node) => ({
    id: node.dataset.category,
    count: Number(node.querySelector('.chip-count').textContent),
    pressed: node.getAttribute('aria-pressed'),
  })));
  assert.ok(chips.length >= 3, `expected a chip per category present, got ${chips.length}`);
  assert.ok(chips.every((chip) => chip.pressed === 'true'), 'everything is shown to begin with');
  const listed = await page.$$eval('#spots-list .card', (nodes) => nodes.length);
  assert.equal(chips.reduce((sum, chip) => sum + chip.count, 0), listed,
    'the counts must add up to the list');
  assert.equal(await page.locator('#map-filters .chip').count(), chips.length,
    'the map carries the same filters');

  // Spots are colour-coded by category, not all the same.
  const pinCategories = await page.$$eval('.pin', (nodes) => nodes.map((n) => n.dataset.category));
  assert.ok(new Set(pinCategories).size >= 3, `pins should be colour-coded, saw ${new Set(pinCategories).size} kinds`);
  const pinColours = await page.$$eval('.pin', (nodes) =>
    [...new Set(nodes.map((n) => getComputedStyle(n).backgroundColor))]);
  assert.ok(pinColours.length >= 3, `expected distinct marker colours, got ${pinColours.join(', ')}`);

  // Switching a category off removes exactly its spots, from both list and map.
  const lakes = chips.find((chip) => chip.id === 'jarvi');
  await page.click('#panel-filters .chip[data-category="jarvi"]');
  await page.waitForTimeout(200);
  const afterList = await page.$$eval('#spots-list .card', (nodes) => nodes.length);
  assert.equal(afterList, listed - lakes.count, 'the list must drop exactly the hidden category');
  assert.equal(await page.locator('.pin[data-category="jarvi"]').count(), 0, 'hidden spots must leave the map');
  assert.equal(await page.getAttribute('#panel-filters .chip[data-category="jarvi"]', 'aria-pressed'), 'false');
  assert.equal(await page.getAttribute('#map-filters .chip[data-category="jarvi"]', 'aria-pressed'), 'false',
    'both filter bars show the same state');
  assert.match(await page.textContent('#spots-list .note'), /Näytetään \d+ \/ \d+/);
  await page.screenshot({ path: join(SHOTS, '7-suodattimet.png') });

  // Preferences must not be swept away by the cache prune on startup.
  const stored = await page.evaluate(() => ({
    filters: localStorage.getItem('kalaonni:filters'),
    theme: localStorage.getItem('kalaonni:theme'),
  }));
  assert.match(stored.filters || '', /jarvi/, 'the filter choice must be stored');

  // The choice survives a reload.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#spots-list .card');
  assert.equal(await page.getAttribute('#panel-filters .chip[data-category="jarvi"]', 'aria-pressed'), 'false',
    'the filter choice must be remembered');

  // Hiding everything explains itself and offers a way back.
  for (const chip of chips) {
    const selector = `#panel-filters .chip[data-category="${chip.id}"]`;
    if (await page.getAttribute(selector, 'aria-pressed') === 'true') await page.click(selector);
  }
  await page.waitForTimeout(200);
  assert.match(await page.textContent('#spots-list .empty'), /piilotettu suodattimilla/);
  await page.click('#spots-list .empty .btn');
  await page.waitForTimeout(200);
  assert.equal(await page.$$eval('#spots-list .card', (nodes) => nodes.length), listed,
    '"show everything" must bring every spot back');

  await context.close();
}

/** A busy Overpass must degrade to the fast half, not to an empty screen. */
async function degradedRun(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'fi-FI',
    permissions: ['geolocation'],
    geolocation: { latitude: HOME.lat, longitude: HOME.lon },
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await stubNetwork(page, { failWaterQuery: true });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });

  await page.waitForSelector('#spots-list .card', { timeout: 20000 });
  const titles = await page.$$eval('#spots-list .card-title', (nodes) => nodes.map((n) => n.textContent));
  assert.ok(titles.includes('Kaupin kalastuslaituri'),
    `marked fishing spots must still be listed, got: ${titles.join(', ')}`);
  assert.ok(!titles.includes('Näsijärvi'), 'the failed half has nothing to contribute');

  const notice = await page.textContent('#spots-notice');
  assert.match(notice, /vesistöt/, `the notice must name the half that failed: ${notice}`);
  assert.ok(await page.locator('#spots-notice .btn').isVisible(), 'a retry must be offered');

  // The species and weather views keep working from the spots we do have.
  await page.locator('#spots-list .card').first().tap();
  await page.waitForSelector('#species-list .card', { timeout: 10000 });
  await page.tap('#tab-weather');
  await page.waitForSelector('#view-weather .hero-value', { timeout: 10000 });

  await page.screenshot({ path: join(SHOTS, 'm5-osittainen.png') });
  await context.close();
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

    // --- sun times are stated outright, not hidden in a subtitle ---------
    const tiles = await page.$$eval('#view-weather .tile', (nodes) => Object.fromEntries(
      nodes.map((node) => [
        node.querySelector('.tile-label').textContent,
        `${node.querySelector('.tile-value').textContent}|${node.querySelector('.tile-sub').textContent}`,
      ]),
    ));
    const [sunrise, sunriseSub] = (tiles['Auringonnousu'] || '').split('|');
    const [sunset, sunsetSub] = (tiles['Auringonlasku'] || '').split('|');
    const [dayLength] = (tiles['Päivän pituus'] || '').split('|');
    assert.equal(sunrise, '06.55', `sunrise tile shows ${sunrise}`);
    assert.equal(sunset, '19.52', `sunset tile shows ${sunset}`);
    assert.equal(dayLength, '12 t 57 min', `day length shows ${dayLength}`);
    // Tense has to match: "nousi 3 t sitten", never "nousee 3 t sitten".
    assert.match(sunriseSub, /^(nousee .* päästä|nousi .* sitten)$/,
      `sunrise subtitle reads "${sunriseSub}"`);
    assert.match(sunsetSub, /^(laskee .* päästä|laski .* sitten)$/,
      `sunset subtitle reads "${sunsetSub}"`);
    assert.match(await page.textContent('#view-weather .sun-line'),
      /Huomenna aurinko nousee \d\d\.\d\d ja laskee \d\d\.\d\d/);

    // Every weather figure carries its own icon, drawn in the theme's ink.
    const tileIcons = await page.$$eval('#view-weather .tile', (nodes) => nodes.map((node) => ({
      label: node.querySelector('.tile-label span:last-child').textContent,
      svg: node.querySelector('.tile-icon svg') ? node.querySelector('.tile-icon').innerHTML.length : 0,
      strokes: node.querySelectorAll('.tile-icon svg [stroke="currentColor"], .tile-icon svg[stroke="currentColor"]').length,
    })));
    assert.equal(tileIcons.length, 9, `expected nine weather tiles, got ${tileIcons.length}`);
    for (const tile of tileIcons) {
      assert.ok(tile.svg > 0, `the "${tile.label}" tile has no icon`);
      assert.ok(tile.strokes > 0, `the "${tile.label}" icon does not follow the theme colour`);
    }

    // --- the verdict speaks like an angler -------------------------------
    const verdict = await page.textContent('#view-weather .hero-verdict');
    assert.match(verdict, /siimoja$/, `unexpected verdict wording: ${verdict}`);
    const readout = await page.textContent('#view-weather .chart-readout');
    assert.match(readout, /siimoja/, 'the chart readout must use the same wording');

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
    const firstVerdict = await page.textContent('#view-weather table.data tbody tr td:nth-child(3)');
    assert.match(firstVerdict, /(kireä|löysä)/, `the table needs the short form, got "${firstVerdict}"`);

    // --- the two numbers are different things, and both are labelled -----
    await page.click('#tab-species');
    await page.waitForSelector('#species-list .card .species-now');

    const label = await page.textContent('#species-list .card .figure-label');
    assert.equal(label, 'esiintyminen', 'the percentage must say what it measures');

    const likelihood = await page.textContent('#species-list .card .figure-value');
    assert.match(likelihood, /^\d+ %$/);

    const cardScore = await page.textContent('#species-list .card .species-now b');
    assert.match(cardScore, /^\d+\/100$/, 'the card must show the species kalaonni too');

    // Selecting that species must show exactly the same kalaonni in the hero.
    const cards = await page.$$('#species-list .card-main');
    await cards[0].click();
    await page.waitForSelector('#view-weather .hero-value');
    const speciesScore = Number(await page.textContent('#view-weather .hero-value'));
    assert.equal(speciesScore, Number(cardScore.split('/')[0]),
      'the species card and the weather hero must agree on the score');
    assert.notEqual(`${speciesScore}`, likelihood.replace(' %', ''),
      'the two numbers are different measures; if they match the test is not proving anything');

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

    await journalRun(browser);
    await followRun(browser);
    await filterRun(browser);
    await radiusRaceRun(browser);
    await checkPwaAssets();
    failures.push(...await mobileRun(browser));
    await degradedRun(browser);
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
