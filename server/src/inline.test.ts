import assert from 'node:assert/strict';
import { test } from 'node:test';
import { helpText } from './chatText.ts';
import { buildInlineResults, type InlineGroup, MAX_INLINE_RESULTS } from './inline.ts';

const opts = { groupLink: (c: string) => `https://t.me/bot/app?startapp=${c}`, botLink: 'https://t.me/bot' };

const group = (id: number, name: string, myBalance = 50000): InlineGroup => ({
  id,
  name,
  currency: 'RUB',
  inviteCode: `code${id}`,
  snapshot: () => ({
    totalSpent: 1_230_000,
    myBalance,
    members: [
      { id: 1, name: 'Я', balance: myBalance },
      { id: 2, name: 'Маша', balance: -myBalance },
    ],
    settlements: [{ from: 2, to: 1, amount: Math.abs(myBalance) }],
  }),
});

test('inline ru: article with card, description and open button', () => {
  const [r] = buildInlineResults('ru', [group(7, 'Дача <3')], '', opts);
  assert.equal(r.id, '7');
  assert.equal(r.title, 'Дача <3');
  assert.match(r.description ?? '', /^Всего .*12.*300.* · вы: \+.*500/);
  const c = r.input_message_content as { message_text: string; parse_mode?: string };
  assert.equal(c.parse_mode, 'HTML');
  assert.match(c.message_text, /<b>Дача &lt;3<\/b>/);
  assert.match(c.message_text, /Маша → Я/);
  const btn = (r.reply_markup as { inline_keyboard: { text: string; url: string }[][] }).inline_keyboard[0][0];
  assert.equal(btn.text, 'Открыть группу');
  assert.equal(btn.url, 'https://t.me/bot/app?startapp=code7');
});

test('inline en and settled description', () => {
  const [r] = buildInlineResults('en', [group(1, 'Trip', 0)], '', opts);
  assert.match(r.description ?? '', /^Total .* · you're settled up$/);
  assert.equal((r.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard[0][0].text, 'Open group');
});

test('inline filters by name case-insensitively, empty query keeps order', () => {
  const gs = [group(1, 'Дача'), group(2, 'Отпуск'), group(3, 'ДАЧА 2')];
  assert.deepEqual(
    buildInlineResults('ru', gs, 'дач', opts).map((r) => r.id),
    ['1', '3'],
  );
  assert.deepEqual(
    buildInlineResults('ru', gs, '  ', opts).map((r) => r.id),
    ['1', '2', '3'],
  );
  assert.deepEqual(buildInlineResults('ru', gs, 'xyz', opts), []);
});

test('inline limits to 20 and loads snapshots lazily', () => {
  let loaded = 0;
  const gs = Array.from({ length: 30 }, (_, i) => {
    const g = group(i + 1, `G${i}`);
    return {
      ...g,
      snapshot: () => {
        loaded++;
        return g.snapshot();
      },
    };
  });
  assert.equal(buildInlineResults('ru', gs, '', opts).length, MAX_INLINE_RESULTS);
  assert.equal(loaded, MAX_INLINE_RESULTS);
});

test('inline without groups: one card pointing to the bot; no link, no button', () => {
  const [r] = buildInlineResults('ru', [], 'q', opts);
  assert.equal(r.title, 'У вас пока нет групп');
  assert.ok(r.reply_markup);
  const [r2] = buildInlineResults('en', [group(1, 'A')], '', { ...opts, groupLink: () => null });
  assert.equal(r2.reply_markup, undefined);
});

test('help private mentions inline usage when username known', () => {
  assert.match(helpText('ru', false, 'kopeika_bot'), /@kopeika_bot/);
  assert.match(helpText('en', false, 'kopeika_bot'), /@kopeika_bot/);
  assert.doesNotMatch(helpText('ru', false), /@/);
});
