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

test('logTelegramError: method, code and description only, never the request payload', async () => {
  const { GrammyError, HttpError } = await import('grammy');
  const { describeTelegramError, logTelegramError } = await import('./logging.ts');
  const secret = 'Ужин в «Тайной группе»: 1500 ₽';
  const e = new GrammyError(
    'x',
    { ok: false, error_code: 400, description: 'Bad Request: chat not found' },
    'sendMessage',
    { chat_id: 123456789, text: secret },
  );
  assert.equal(describeTelegramError(e), 'sendMessage 400 Bad Request: chat not found');
  assert.equal(describeTelegramError(new Error('boom')), 'boom');
  assert.ok(describeTelegramError(new HttpError('net down', new Error('ECONNRESET'))).startsWith('network error'));

  const lines: unknown[][] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => void lines.push(args);
  try {
    logTelegramError('sendMessage failed', e);
  } finally {
    console.warn = orig;
  }
  const out = lines.flat().join(' ');
  assert.equal(out, 'sendMessage failed: sendMessage 400 Bad Request: chat not found');
  assert.ok(!out.includes('Тайной') && !out.includes('123456789'));
});

test('logTelegramError: non-Telegram errors keep their stack trace', async () => {
  const { logTelegramError } = await import('./logging.ts');
  const bug = new TypeError('real bug');
  const calls: unknown[][] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => void calls.push(args);
  try {
    logTelegramError('Recurring #1 failed', bug);
  } finally {
    console.error = orig;
  }
  assert.deepEqual(calls, [['Recurring #1 failed', bug]]);
  assert.ok(String((calls[0][1] as Error).stack).includes('real bug'));
});
