import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRateLimiter } from './rateLimit.ts';

test('blocks over the limit and recovers as the window slides', () => {
  let t = 0;
  const rl = createRateLimiter({ limit: 3, windowMs: 1000, now: () => t });
  assert.ok(rl.allow(1));
  t = 400;
  assert.ok(rl.allow(1));
  assert.ok(rl.allow(1));
  assert.equal(rl.allow(1), false);
  t = 999;
  assert.equal(rl.allow(1), false);
  t = 1000; // first hit (t=0) left the window
  assert.ok(rl.allow(1));
  assert.equal(rl.allow(1), false);
});

test('users are limited independently', () => {
  const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
  assert.ok(rl.allow(1));
  assert.equal(rl.allow(1), false);
  assert.ok(rl.allow(2));
});

test('idle users are swept from memory', () => {
  let t = 0;
  const rl = createRateLimiter({ limit: 5, windowMs: 1000, now: () => t });
  for (let i = 0; i < 100; i++) rl.allow(i);
  assert.equal(rl.size(), 100);
  t = 2000;
  rl.allow(999);
  assert.equal(rl.size(), 1);
});
