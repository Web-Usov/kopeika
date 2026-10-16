import './test-env.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appLink, retryDelaySec } from './bot.ts';

test('retryDelaySec: 5, 10, 30, 60 s, then every minute', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 100].map(retryDelaySec), [5, 10, 30, 60, 60, 60, 60]);
});

test('appLink is null until the bot is ready', () => {
  assert.equal(appLink('abc'), null);
});

test('isChatGone: kicked / no rights / forbidden are final, other errors are not', async () => {
  const { GrammyError } = await import('grammy');
  const { isChatGone } = await import('./bot.ts');
  const err = (code: number, description: string) =>
    new GrammyError('x', { ok: false, error_code: code, description }, 'sendMessage', {});
  assert.equal(isChatGone(err(403, 'Forbidden: bot was kicked from the supergroup chat')), true);
  assert.equal(isChatGone(err(400, 'Bad Request: chat not found')), true);
  assert.equal(isChatGone(err(400, 'Bad Request: have no rights to send a message')), true);
  assert.equal(isChatGone(err(429, 'Too Many Requests')), false);
  assert.equal(isChatGone(err(400, 'Bad Request: message is too long')), false);
  assert.equal(isChatGone(new Error('network')), false);
});
