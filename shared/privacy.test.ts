import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOT_USERNAME, policy, type ReceiptsProvider } from './privacy.ts';

const providers: ReceiptsProvider[] = ['anthropic', 'openrouter'];

test('both languages have the same structure and name the contact bot', () => {
  for (const r of providers) {
    const ru = policy('ru', r);
    const en = policy('en', r);
    assert.equal(ru.sections.length, en.sections.length);
    ru.sections.forEach((s, i) => {
      assert.equal(s.paragraphs?.length ?? 0, en.sections[i].paragraphs?.length ?? 0, s.heading);
      assert.equal(s.items?.length ?? 0, en.sections[i].items?.length ?? 0, s.heading);
    });
    for (const p of [ru, en]) assert.ok(JSON.stringify(p).includes(BOT_USERNAME));
  }
});

test('the receipt provider in use is named, the other one is not', () => {
  for (const lang of ['ru', 'en'] as const) {
    const anthropic = JSON.stringify(policy(lang, 'anthropic'));
    assert.match(anthropic, /Anthropic/);
    assert.match(anthropic, /30 (дней|days)/);
    assert.doesNotMatch(anthropic, /OpenRouter/);

    const openrouter = JSON.stringify(policy(lang, 'openrouter'));
    assert.match(openrouter, /OpenRouter/);
    assert.doesNotMatch(openrouter, /Anthropic/);
    assert.doesNotMatch(openrouter, /30 (дней|days)/);
  }
});
