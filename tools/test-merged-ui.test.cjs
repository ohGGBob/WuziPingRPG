'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ui = require('./test-merged-ui.js');

test('home cards and the module registry name the same set', () => {
  const result = ui.staticCheck(ui.repoRoot());
  assert.ok(result.cards.length >= 8);
  assert.deepEqual(new Set(result.cards), new Set(result.modules));
  assert.equal(result.browser, false);
  assert.equal(result.android_device_tested, false);
});

test('parser reads home-card data-mode and ignores other data-mode attributes', () => {
  const html = [
    '<button class="home-card" data-mode="lecture"></button>',
    '<button class="other" data-mode="object"></button>',
    '<button class="home-card extra" data-mode="novel"></button>'
  ].join('');
  assert.deepEqual(ui.homeCardModes(html), ['lecture', 'novel']);
});

test('the script does not point at a machine-local drive', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const text = fs.readFileSync(path.join(__dirname, 'test-merged-ui.js'), 'utf8');
  assert.equal(text.includes('D:/'), false);
  assert.equal(text.includes('D:\\'), false);
  assert.equal(/^\s*(const|let|var)?\s*\w+\s*=\s*await import/m.test(text), false);
});
