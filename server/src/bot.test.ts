import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appLink, retryDelaySec } from './bot.ts';

test('retryDelaySec: 5, 10, 30, 60 s, then every minute', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 100].map(retryDelaySec), [5, 10, 30, 60, 60, 60, 60]);
});

test('appLink is null until the bot is ready', () => {
  assert.equal(appLink('abc'), null);
});
