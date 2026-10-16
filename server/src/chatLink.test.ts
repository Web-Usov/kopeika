import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkedMessage, welcomeMessage } from './chatLink.ts';

test('welcome message: link button in the adder language', () => {
  const ru = welcomeMessage('ru', 'https://t.me/bot/app?startapp=link_x');
  assert.match(ru.text, /Копейка/);
  assert.deepEqual(ru.button, { text: 'Привязать к группе Копейки', url: 'https://t.me/bot/app?startapp=link_x' });
  const en = welcomeMessage('en', 'https://t.me/bot/app?startapp=link_x');
  assert.match(en.text, /Kopeika/);
  assert.equal(en.button?.text, 'Link to a Kopeika group');
});

test('welcome message without app link: text only', () => {
  for (const lang of ['ru', 'en'] as const) {
    const m = welcomeMessage(lang, null);
    assert.equal(m.button, undefined);
    assert.ok(m.text.length > 0);
  }
});

test('linked message: group name and join button', () => {
  const ru = linkedMessage('ru', 'Дача', 'https://t.me/bot/app?startapp=abc');
  assert.equal(ru.text, 'Чат привязан к группе «Дача»');
  assert.deepEqual(ru.button, { text: 'Вступить в группу', url: 'https://t.me/bot/app?startapp=abc' });
  const en = linkedMessage('en', 'Trip', 'https://t.me/bot/app?startapp=abc');
  assert.equal(en.text, 'The chat is linked to the group “Trip”');
  assert.equal(en.button?.text, 'Join the group');
  assert.equal(linkedMessage('en', 'Trip', null).button, undefined);
});
