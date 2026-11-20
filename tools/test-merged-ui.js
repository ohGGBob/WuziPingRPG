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
const assert = require('node:assert/strict');

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

async function reloadSavedWorkspace(page) {
  // The app updates this status when the host acknowledges its latest revision.
  await page.waitForFunction(() => /草稿已保存|保存失败/.test(document.querySelector('#saveState').textContent));
  assert.equal(await page.locator('#saveState').textContent(), '草稿已保存');
  await page.reload({waitUntil: 'networkidle'});
  await page.waitForSelector('#landing[data-ready="1"]');
}

async function checkWorkspaces(page) {
  const desk = page.locator('#workspaceDesk');
  const study = page.locator('#deskStudy');
  const code = page.locator('#deskCode');
  const body = desk.locator('#deskBody');
  await desk.waitFor({state: 'visible'});
  assert.equal(await study.getAttribute('aria-selected'), 'true', 'new workspaces start in study');
  await code.click();
  assert.equal(await code.getAttribute('aria-selected'), 'true');
  await reloadSavedWorkspace(page);
  assert.equal(await code.getAttribute('aria-selected'), 'true', 'programming tab must survive reload');

  const oldFiles = await page.evaluate(() => window.Studio.getState().files.map(file => file.path));
  await desk.locator('#codeBody').getByRole('button', {name: '新建 Python', exact: true}).click();
  await page.locator('#landing').waitFor({state: 'hidden'});
  const draft = await page.evaluate(() => window.Studio.getState().active);
  assert(draft.endsWith('.py') && !oldFiles.includes(draft), 'create a new, independent Python file');
  const editor = page.locator('#workbench .cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  const sample = 'print(6 * 7)';
  await page.keyboard.insertText(sample);
  await page.locator('#runButton').click();
  await page.waitForFunction(() => /执行完成|执行失败|超时|未能启动/.test(document.querySelector('#runState').textContent), null, {timeout: 60000});
  const status = await page.locator('#runState').innerText();
  const pythonOutput = (await page.locator('#output').innerText()).trim();
  assert.match(status, /^执行完成/, status + '\n' + pythonOutput);
  assert.equal(pythonOutput, '42', 'offline Python worker should print 42');
  assert.equal(await page.evaluate(() => window.Studio.back()), true);
  await desk.waitFor({state: 'visible'});
  assert.equal(await code.getAttribute('aria-selected'), 'true');
  await reloadSavedWorkspace(page);
  assert.equal(await page.evaluate(path => window.Studio.getState().files.find(f => f.path === path)?.text, draft), sample);

  await study.click();
  await body.getByRole('button', {name: /记忆卡片/}).click();
  await page.locator('#landing').waitFor({state: 'hidden'});
  assert.equal(await page.evaluate(() => window.Studio.getState().mode), 'cards');
  assert.equal(await page.evaluate(() => window.Studio.back()), true);
  await desk.waitFor({state: 'visible'});
  assert.equal(await study.getAttribute('aria-selected'), 'true');

  // The host can save while a tool is open, but reloading renders the tab root.
  await body.getByRole('button', {name: /记忆卡片/}).click();
  await page.locator('#landing').waitFor({state: 'hidden'});
  await page.evaluate(() => window.Studio.flush());
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('test-workspace') || 'null')
    ?.ui?.tabs?.stacks?.home?.includes('cards'));
  await reloadSavedWorkspace(page);
  assert.equal(await study.getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => window.Studio.getState().tabDepth), 0,
    'reloading to a tab root must not retain an invisible module route');
  assert.equal(await page.evaluate(() => window.Studio.back()), false);
  return {draft, pythonOutput};
}

async function checkHomeNavigation(page) {
  const back = () => page.evaluate(() => window.Studio.back());
  const focusedId = () => page.evaluate(() => document.activeElement.id);
  const home = page.locator('#landing');
  const catalog = page.locator('#toolCatalog');
  const opener = page.locator('#deskCatalog');
  // The catalog toolbar and the module toolbar have their own back buttons.
  const returnButton = page.locator('#workspaceDesk .workspace-bar')
    .getByRole('button', {name: '返回工作区', exact: true});
  const scroll = catalog;

  await opener.click();
  await returnButton.waitFor({state: 'visible'});
  assert.equal(await focusedId(), 'deskCatalog');
  assert.equal(await catalog.locator('.brandver, #starStage, #skyRipple, #resumeCard').count(), 0);

  const viewport = page.viewportSize();
  for (const size of [{width:320,height:570}, {width:360,height:720}, {width:760,height:360}, viewport]) {
    await page.setViewportSize(size);
    await page.waitForFunction(() => {
      const pages = document.getElementById('workspacePages');
      return document.getElementById('deskCatalog').getAttribute('aria-selected') === 'true' &&
        Math.abs(pages.scrollLeft - 2 * pages.clientWidth) <= 2;
    }, null, {timeout: 5000});
    const bounds = await page.locator('#workspaceDesk').boundingBox();
    const backBox = await returnButton.boundingBox();
    const titleBox = await page.getByRole('heading', {name:'全部工具'}).boundingBox();
    assert(backBox.x - bounds.x <= 16 && backBox.width >= 44 && backBox.height >= 44);
    assert(backBox.x + backBox.width <= titleBox.x, 'the back button must not cover the title');
    await returnButton.click({trial: true, timeout: 5000});
    assert(await scroll.evaluate(el => el.scrollWidth <= el.clientWidth), 'the tools list must fit horizontally');
    const tabBox = await opener.boundingBox();
    // The tabbed workspace places these controls above the page content. Keep
    // testing reachability, not the old bottom position.
    const pagesBox = await page.locator('#workspacePages').boundingBox();
    const mainNavBox = await page.locator('#studioTabbar').boundingBox();
    assert(tabBox && pagesBox && tabBox.x >= 0 && tabBox.y >= titleBox.y + titleBox.height &&
      tabBox.height >= 48 && tabBox.x + tabBox.width <= size.width &&
      tabBox.y + tabBox.height <= pagesBox.y + 1,
      'the tools tab must have a usable touch target between the title and the page');
    assert(mainNavBox && mainNavBox.y >= pagesBox.y + pagesBox.height - 1 &&
      Math.abs(mainNavBox.y + mainNavBox.height - size.height) <= 1,
      'main navigation must stay at the bottom without covering the page');
    await opener.click({trial: true, timeout: 5000});
  }
  await returnButton.click();
  await returnButton.waitFor({state: 'hidden'});
  assert.equal(await focusedId(), 'deskStudy');
  for (const dismiss of [() => back(), () => page.keyboard.press('Escape')]) {
    await opener.click();
    await dismiss();
    await returnButton.waitFor({state: 'hidden'});
  }

  await opener.click();
  const moduleCard = catalog.locator('.home-card[data-mode="ai"]');
  await moduleCard.scrollIntoViewIfNeeded();
  await moduleCard.evaluate(el => el.addEventListener('click', () => {
    window.__scrollAtModuleEntry = document.querySelector('#toolCatalog').scrollTop;
  }, {capture: true, once: true}));
  await moduleCard.click();
  const before = await page.evaluate(() => window.__scrollAtModuleEntry);
  assert(before > 50, 'enter a tool from below the first screen');
  await home.waitFor({state: 'hidden'});
  await page.keyboard.press('Escape');
  assert.equal(await home.isVisible(), false, 'Escape must leave the tool open');
  assert.equal(await back(), true);
  await catalog.waitFor({state: 'visible'});
  assert.equal(await page.evaluate(() => document.activeElement.dataset.mode), 'ai');
  const after = await scroll.evaluate(el => el.scrollTop);
  assert(Math.abs(before - after) <= 4, 'return should restore the directory scroll position');
  assert.equal(await back(), true, 'the directory returns to the workspace');
  await opener.waitFor({state: 'visible'});
  assert.equal(await focusedId(), 'deskStudy');
  assert.equal(await back(), false, 'the workspace returns control to Android');

  // Switching primary tabs is different from returning from a module.
  const studioTabs = page.locator('#studioTabbar');
  await opener.click();
  await returnButton.waitFor({state: 'visible'});
  await studioTabs.getByRole('tab', {name: '最近', exact: true}).click();
  await page.locator('#recentRoot').waitFor({state: 'visible'});
  await studioTabs.getByRole('tab', {name: '首页', exact: true}).click();
  await returnButton.waitFor({state: 'hidden'});
  assert.equal(await opener.getAttribute('aria-selected'), 'false', 'switching tabs resets the tools directory');
  return {scrollBefore: before, scrollAfter: after, screenSizes: 4, tabSwitchResetsCatalog: true};
}

async function checkFallbackCatalog(browser, url) {
  const page = await browser.newPage({viewport: {width: 412, height: 800}});
  try {
    await page.addInitScript(() => {
      const normalContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
        return /webgl/i.test(kind) ? null : normalContext.call(this, kind, ...args);
      };
    });
    await page.goto(url, {waitUntil: 'networkidle'});
    await page.waitForSelector('#landing[data-ready="1"]');
    await page.locator('#deskCatalog').click();
    await page.locator('.home-card[data-mode="python"]').waitFor({state: 'visible'});
    assert.equal(await page.locator('#toolCatalog').isVisible(), true);
    assert.equal(await page.locator('#toolCatalog canvas').count(), 0);
    await page.locator('#catalogHome').click();
    await page.locator('#workspaceDesk').waitFor({state: 'visible'});
    await page.locator('#deskCatalog').click();
    assert.equal(await page.evaluate(() => window.Studio.back()), true);
    await page.locator('#workspaceDesk').waitFor({state: 'visible'});
    assert.equal(await page.evaluate(() => window.Studio.back()), false);
  } finally {
    await page.close();
  }
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
  const page = await browser.newPage({ viewport: { width: 412, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    window.nativeCalls = [];
    window.StudioBridge = {
      postMessage(raw) {
        const message = JSON.parse(raw);
        window.nativeCalls.push(message);
        // Give snapshot IO a separate turn with a realistic acknowledgement delay.
        setTimeout(() => {
          if (message.type === 'ready') {
            window.StudioNative.receive({ type: 'capabilities', scan: true, photo: true, game: true, sdk: 34 });
            window.StudioNative.receive({ type: 'restore', data: JSON.parse(sessionStorage.getItem('test-workspace') || 'null') });
          }
          if (message.type === 'snapshot') {
            sessionStorage.setItem('test-workspace', JSON.stringify(message.data));
            window.StudioNative.receive({ type: 'snapshotSaved', id: message.id, ok: true });
          }
        }, message.type === 'snapshot' ? 150 : 0);
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
    const {draft, pythonOutput} = await checkWorkspaces(page);
    const mistakeReview = await require('./tests/mistake-review.cjs')(page, reloadSavedWorkspace);
    const pythonLabs = await require('./tests/python-lab.cjs')(page, reloadSavedWorkspace);
    const workspaceWheel = await require('./tests/workspace-wheel.cjs')(page, reloadSavedWorkspace);
    const mobilePages = await require('./tests/workspace-pages.cjs')(page);
    const navigation = await checkHomeNavigation(page);
    await checkFallbackCatalog(browser, url);
    if (errors.length) throw new Error(errors.join('\n'));
    return { cards, browser: true, draft, pythonOutput, mistakeReview, pythonLabs, workspaceWheel, mobilePages, navigation, catalogWithoutWebGL: true, consoleErrors: errors, android_device_tested: false };
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
