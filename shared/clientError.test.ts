import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routePattern, scrubText, stackHead } from './clientError.ts';

test('routePattern drops ids, codes, tokens and query', () => {
  assert.equal(routePattern('#/g/12/expense/345?tab=x'), '/g/:id/expense/:eid');
  assert.equal(routePattern('/g/12/expense/new'), '/g/:id/expense/new');
  assert.equal(routePattern('/join/SECRETCODE'), '/join/:code');
  assert.equal(routePattern('/link/tok-en_1'), '/link/:token');
  assert.equal(routePattern('/'), '/');
  assert.equal(routePattern('/Иван/12'), '/?/?');
  assert.equal(routePattern('/g/:id/settings'), '/g/:id/settings');
});

test('scrubText removes query strings and launch params', () => {
  assert.equal(scrubText('at https://x.ru/a.js?v=1#/g/5'), 'at https://x.ru/a.js');
  assert.ok(!scrubText('fail tgWebAppData=user%3D1&hash=abc').includes('abc'));
  assert.ok(!scrubText('hash=deadbeef').includes('deadbeef'));
});

test('stackHead keeps the first lines only', () => {
  const stack = Array.from({ length: 12 }, (_, i) => `at f${i} (https://x.ru/a.js?q=${i}:1:1)`).join('\n');
  const head = stackHead(stack);
  assert.equal(head.split('\n').length, 5);
  assert.ok(!head.includes('q='));
});
