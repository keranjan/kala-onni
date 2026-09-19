/**
 * Render the app icon to the PNG sizes a home-screen install needs.
 * Uses the Chromium that Playwright already provides, so no image library
 * is added to the project. Run with: npm run icons
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const OUT = fileURLToPath(new URL('../assets/icons/', import.meta.url));

/** @param {number} inset padding as a share of the canvas (maskable needs a safe zone) */
const icon = ({ rounded = true, inset = 0 } = {}) => {
  const scale = 1 - inset * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ''} fill="#2a78d6"/>
  <g transform="translate(${256 * inset * 2} ${256 * inset * 2}) scale(${scale})">
    <path d="M92 262c62-96 186-118 268-62l70-50-20 112 20 112-70-50c-82 56-206 34-268-62z"
          fill="#ffffff"/>
    <circle cx="300" cy="230" r="15" fill="#2a78d6"/>
    <path d="M150 300c26 14 56 20 86 18" stroke="#2a78d6" stroke-width="12"
          stroke-linecap="round" fill="none" opacity=".35"/>
  </g>
</svg>`;
};

const TARGETS = [
  { file: 'icon.svg', svg: icon(), raw: true },
  { file: 'icon-192.png', svg: icon(), size: 192 },
  { file: 'icon-512.png', svg: icon(), size: 512 },
  { file: 'icon-maskable-512.png', svg: icon({ rounded: false, inset: 0.1 }), size: 512 },
  { file: 'apple-touch-icon.png', svg: icon({ rounded: false }), size: 180 },
];

const executablePath = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome']
  .find((candidate) => existsSync(candidate));

if (!existsSync(OUT)) await mkdir(OUT, { recursive: true });

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage();

for (const target of TARGETS) {
  if (target.raw) {
    await writeFile(join(OUT, target.file), target.svg);
    continue;
  }
  await page.setViewportSize({ width: target.size, height: target.size });
  await page.setContent(
    `<style>html,body{margin:0;padding:0}svg{display:block;width:${target.size}px;height:${target.size}px}</style>${target.svg}`,
  );
  await page.screenshot({ path: join(OUT, target.file), omitBackground: true });
  console.log(`kirjoitettu ${target.file} (${target.size}px)`);
}

await browser.close();
