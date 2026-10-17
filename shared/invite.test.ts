import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStartParam, startParamFor } from './invite.ts';

test('plain code is a link (old links keep working)', () => {
  assert.deepEqual(parseStartParam('abcDEF123_-x'), { code: 'abcDEF123_-x', source: 'link' });
});

test('card suffix is stripped', () => {
  assert.deepEqual(parseStartParam('abcDEF123_-x-c'), { code: 'abcDEF123_-x', source: 'card' });
});

test('a code that itself ends with "-c" is not mistaken for a card', () => {
  assert.deepEqual(parseStartParam('abcDEF1234-c'), { code: 'abcDEF1234-c', source: 'link' });
  assert.deepEqual(parseStartParam('abcDEF1234-c-c'), { code: 'abcDEF1234-c', source: 'card' });
});

test('startParamFor round-trips', () => {
  for (const source of ['link', 'card'] as const)
    assert.deepEqual(parseStartParam(startParamFor('abcDEF123_-x', source)), { code: 'abcDEF123_-x', source });
});
