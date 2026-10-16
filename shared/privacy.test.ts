import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOT_USERNAME, policies } from './privacy.ts';

test('both languages have the same structure and name the contact bot', () => {
  const { ru, en } = policies;
  assert.equal(ru.sections.length, en.sections.length);
  ru.sections.forEach((s, i) => {
    assert.equal(s.paragraphs?.length ?? 0, en.sections[i].paragraphs?.length ?? 0, s.heading);
    assert.equal(s.items?.length ?? 0, en.sections[i].items?.length ?? 0, s.heading);
  });
  for (const p of [ru, en]) assert.ok(JSON.stringify(p).includes(BOT_USERNAME));
});
