#!/usr/bin/env node
/* Static home-card check, runnable with `node tools/test-merged-ui.js`.
 *
 * The old file was a Playwright snippet: top-level await, a hardcoded D: path,
 * and an injected `page`/`assert`. Node could not execute it. This file checks
 * that studio/web/src/index.html and studio/web/src/back.js name the same home
 * modules. Pass --browser plus STUDIO_PREVIEW_URL to click through with
 * Playwright when that package is installed. Browser mode is not the default
 * and is not claimed as an Android or device test.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function repoRoot() {
  return path.resolve(__dirname, '..');
}

function homeCardModes(html) {
  const modes = [];
  const tags = html.match(/<button\b[^>]*\bhome-card\b[^>]*>/g) || [];
  for (const tag of tags) {
    const mode = /data-mode="([^"]+)"/.exec(tag);
    if (!mode) throw new Error('home card is missing data-mode: ' + tag);
    modes.push(mode[1]);
  }
  return modes;
}

function moduleIds(source) {
  const start = source.indexOf('export const MODULES=[');
  if (start < 0) throw new Error('MODULES registry was not found in back.js');
  const end = source.indexOf('];', start);
  if (end < 0) throw new Error('MODULES registry does not close');
  const block = source.slice(start, end);
  const ids = [];
  const re = /\{id:'([^']+)'/g;
  let match;
  while ((match = re.exec(block))) ids.push(match[1]);
  if (!ids.length) throw new Error('MODULES registry has no ids');
  return ids;
}

function staticCheck(root) {
  const htmlPath = path.join(root, 'studio', 'web', 'src', 'index.html');
  const backPath = path.join(root, 'studio', 'web', 'src', 'back.js');
  const cards = homeCardModes(fs.readFileSync(htmlPath, 'utf8'));
  const modules = moduleIds(fs.readFileSync(backPath, 'utf8'));
  const cardSet = new Set(cards);
  const moduleSet = new Set(modules);
  const missing = modules.filter((id) => !cardSet.has(id));
  const extra = cards.filter((id) => !moduleSet.has(id));
  if (missing.length || extra.length || cardSet.size !== cards.length) {
    const error = new Error(
      'home cards and MODULES diverged: missing=' + missing.join(',') +
      ' extra=' + extra.join(',')
    );
    error.cards = cards;
    error.modules = modules;
    throw error;
  }
  return {
    cards,
    modules,
    orderMatches: cards.join(',') === modules.join(','),
    browser: false,
    android_device_tested: false
  };
}

async function browserCheck(root) {
  const url = process.env.STUDIO_PREVIEW_URL;
  if (!url) throw new Error('Set STUDIO_PREVIEW_URL to a page Playwright can open');
  let playwright;
  try {
    playwright = require('playwright');
  } catch (error) {
    throw new Error('Playwright is not installed; static check does not need it. ' + error.message);
  }
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    window.nativeCalls = [];
    window.StudioBridge = {
      postMessage(raw) {
        const message = JSON.parse(raw);
        window.nativeCalls.push(message);
        setTimeout(() => {
          if (message.type === 'ready') {
            window.StudioNative.receive({ type: 'capabilities', scan: true, photo: true, game: true, sdk: 34 });
            window.StudioNative.receive({ type: 'restore', data: null });
          }
          if (message.type === 'snapshot') window.StudioNative.receive({ type: 'snapshotSaved', id: message.id, ok: true });
        }, 0);
      }
    };
  });
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('#landing')?.dataset.ready === '1');
    const cards = await page.locator('.home-card').evaluateAll((elements) => elements.map((element) => element.dataset.mode));
    const expected = staticCheck(root).cards;
    if (JSON.stringify(cards) !== JSON.stringify(expected)) {
      throw new Error('rendered cards ' + JSON.stringify(cards) + ' != ' + JSON.stringify(expected));
    }
    if (errors.length) throw new Error(errors.join('\n'));
    const outDir = path.join(root, 'artifacts', 'studio-v0.1');
    fs.mkdirSync(outDir, { recursive: true });
    const result = { cards, browser: true, consoleErrors: errors, android_device_tested: false };
    fs.writeFileSync(path.join(outDir, 'merge-ui-static.json'), JSON.stringify(result, null, 2));
    return result;
  } finally {
    await browser.close();
  }
}

async function main() {
  const root = process.env.WUZIPING_ROOT ? path.resolve(process.env.WUZIPING_ROOT) : repoRoot();
  if (process.argv.includes('--browser')) {
    const result = await browserCheck(root);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const result = staticCheck(root);
  console.log(JSON.stringify(result, null, 2));
  console.log('SKIP browser: run with --browser and STUDIO_PREVIEW_URL when Playwright is installed. Not an Android test.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
}

module.exports = { homeCardModes, moduleIds, staticCheck, repoRoot };
