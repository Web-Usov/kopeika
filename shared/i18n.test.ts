import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createT, dictionaries, flatKeys, pickLang, t } from './i18n/index.ts';
import { computeShares, formatMoney, SplitError } from './money.ts';

const nbsp = (s: string) => s.replace(/\s/g, ' ');

test('ru and en have identical key sets', () => {
  assert.deepEqual(flatKeys(dictionaries.en).sort(), flatKeys(dictionaries.ru).sort());
});

test('every {placeholder} of a Russian string exists in the English one', () => {
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const flat = (lang: 'ru' | 'en') => {
    const out = new Map<string, string>();
    const walk = (node: unknown, path: string) => {
      if (typeof node === 'string') out.set(path, node);
      else if (typeof (node as { one?: unknown }).one === 'string') {
        // plural: compare the set of placeholders of the "one" form
        out.set(path, (node as { one: string }).one);
      } else for (const [k, v] of Object.entries(node as object)) walk(v, path ? `${path}.${k}` : k);
    };
    walk(dictionaries[lang], '');
    return out;
  };
  const ru = flat('ru');
  const en = flat('en');
  for (const [key, value] of ru) assert.deepEqual(placeholders(en.get(key) ?? ''), placeholders(value), key);
});

test('pickLang: ru* -> ru, other -> en, unknown -> ru', () => {
  assert.equal(pickLang('ru'), 'ru');
  assert.equal(pickLang('ru-RU'), 'ru');
  assert.equal(pickLang('en'), 'en');
  assert.equal(pickLang('de'), 'en');
  assert.equal(pickLang('pt-br'), 'en');
  assert.equal(pickLang(undefined), 'ru');
  assert.equal(pickLang(''), 'ru');
  assert.equal(pickLang(null), 'ru');
});

test('interpolation and keys', () => {
  assert.equal(t('ru', 'common.youParen', { name: 'Маша' }), 'Маша (вы)');
  assert.equal(t('en', 'common.youParen', { name: 'Masha' }), 'Masha (you)');
  assert.equal(createT('en')('common.today'), 'Today');
  assert.equal(createT('ru')('common.yesterday'), 'Вчера');
  // @ts-expect-error a typo in a key is a compile error
  assert.throws(() => t('en', 'common.nope'));
});

test('plurals: ru one/few/many', () => {
  const members = (n: number) => t('ru', 'common.members', { count: n });
  assert.equal(members(1), '1 участник');
  assert.equal(members(2), '2 участника');
  assert.equal(members(4), '4 участника');
  assert.equal(members(5), '5 участников');
  assert.equal(members(11), '11 участников');
  assert.equal(members(12), '12 участников');
  assert.equal(members(21), '21 участник');
  assert.equal(members(22), '22 участника');
  assert.equal(members(100), '100 участников');
});

test('plurals: en one/other', () => {
  const members = (n: number) => t('en', 'common.members', { count: n });
  assert.equal(members(1), '1 member');
  assert.equal(members(2), '2 members');
  assert.equal(members(11), '11 members');
  assert.equal(members(21), '21 members');
});

test('formatMoney for both languages', () => {
  assert.equal(nbsp(formatMoney(123456, 'RUB', 'ru')), '1 234,56 ₽');
  assert.equal(nbsp(formatMoney(100000, 'RUB', 'ru')), '1 000 ₽');
  assert.equal(formatMoney(123456, 'USD', 'en'), '$1,234.56');
  assert.equal(formatMoney(100000, 'USD', 'en'), '$1,000');
  assert.equal(nbsp(formatMoney(100, 'XXX_BAD', 'en')), '1 XXX_BAD');
});

test('SplitError carries a key that both dictionaries translate', () => {
  try {
    computeShares(1000, 'exact', [{ memberId: 1, value: 500 }]);
    assert.fail('should throw');
  } catch (e) {
    assert.ok(e instanceof SplitError);
    assert.equal(t('ru', e.key), 'Сумма долей не совпадает с общей суммой');
    assert.equal(t('en', e.key), 'The amounts don’t add up to the total');
  }
});
