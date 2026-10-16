import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDevAuth, parseNumber } from './config.ts';

test('parseNumber: default for unset or empty', () => {
  assert.equal(parseNumber('X', undefined, { default: 5 }), 5);
  assert.equal(parseNumber('X', '  ', { default: 5 }), 5);
});

test('parseNumber: accepts valid values and bounds', () => {
  assert.equal(parseNumber('X', '120', { default: 1 }), 120);
  assert.equal(parseNumber('H', '0', { default: 20, min: 0, max: 23 }), 0);
  assert.equal(parseNumber('H', '23', { default: 20, min: 0, max: 23 }), 23);
});

test('parseNumber: rejects junk, naming the variable', () => {
  for (const raw of ['abc', 'NaN', 'Infinity', '-1', '0', '1.5', '1e999']) {
    assert.throws(() => parseNumber('RATE_LIMIT_PER_MIN', raw, { default: 1 }), /RATE_LIMIT_PER_MIN/, raw);
  }
  assert.throws(() => parseNumber('CHAT_DIGEST_HOUR', '24', { default: 20, min: 0, max: 23 }), /CHAT_DIGEST_HOUR/);
  assert.throws(() => parseNumber('PORT', '70000', { default: 3000, max: 65535 }), /PORT/);
});

test('checkDevAuth: refuses DEV_AUTH in production unless explicitly allowed', () => {
  assert.throws(() => checkDevAuth({ NODE_ENV: 'production', DEV_AUTH: '1' }), /DEV_AUTH/);
  assert.doesNotThrow(() => checkDevAuth({ NODE_ENV: 'production', DEV_AUTH: '1', ALLOW_DEV_AUTH_IN_PRODUCTION: '1' }));
  assert.doesNotThrow(() => checkDevAuth({ NODE_ENV: 'production' }));
  assert.doesNotThrow(() => checkDevAuth({ DEV_AUTH: '1' }));
});
