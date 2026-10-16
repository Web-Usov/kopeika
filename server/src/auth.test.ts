import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signInitData, validateInitData } from './auth.ts';

const token = '123456:TEST-token';
const now = 1_760_000_000_000;
const fields = {
  auth_date: String(now / 1000 - 60),
  query_id: 'AAE',
  user: JSON.stringify({ id: 42, first_name: 'Алекс', username: 'alex' }),
  start_param: 'abc_DEF-1',
};

test('accepts correctly signed initData', () => {
  const data = validateInitData(signInitData(fields, token), token, 3600, now);
  assert.equal(data?.user.id, 42);
  assert.equal(data?.user.first_name, 'Алекс');
  assert.equal(data?.startParam, 'abc_DEF-1');
});

test('rejects tampered data, wrong token and expired data', () => {
  const raw = signInitData(fields, token);
  const tampered = raw.replace('%22id%22%3A42', '%22id%22%3A43');
  assert.notEqual(tampered, raw);
  assert.equal(validateInitData(tampered, token, 3600, now), null);
  assert.equal(validateInitData(raw, '999:other', 3600, now), null);
  assert.equal(validateInitData(raw, token, 30, now), null);
  assert.equal(validateInitData('', token, 3600, now), null);
});
