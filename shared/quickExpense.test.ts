import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseQuickExpense } from './quickExpense.ts';

type O = { lang: 'ru' | 'en'; groupCurrency: string };
const ru: O = { lang: 'ru', groupCurrency: 'RUB' };
const en: O = { lang: 'en', groupCurrency: 'USD' };
const p = (s: string, o: O = ru) => parseQuickExpense(s, o);

test('amount first or last', () => {
  assert.deepEqual(p('1200 такси'), { title: 'такси', amount: 120000, currency: 'RUB', category: 'transport' });
  assert.deepEqual(p('такси 1200'), { title: 'такси', amount: 120000, currency: 'RUB', category: 'transport' });
  assert.deepEqual(p('Ужин в кафе 2500'), { title: 'Ужин в кафе', amount: 250000, currency: 'RUB', category: 'food' });
  assert.deepEqual(p('пицца 899 вечером'), {
    title: 'пицца вечером',
    amount: 89900,
    currency: 'RUB',
    category: 'food',
  });
});

test('separators and decimals', () => {
  assert.equal(p('1 200 такси')?.amount, 120000);
  assert.equal(p('такси 1 200')?.amount, 120000);
  assert.equal(p('1 200,50 ₽ ужин')?.amount, 120050);
  assert.equal(p('1 200,50 ₽ ужин')?.title, 'ужин');
  assert.equal(p('кофе 3.5', en)?.amount, 350);
  assert.equal(p('кофе 3,5')?.amount, 350);
  assert.equal(p('coffee 3.50', en)?.amount, 350);
  assert.equal(p('12 345 аренда')?.amount, 1234500);
  assert.equal(p('такси 1200.')?.amount, 120000);
});

test('rejects: no amount, zero, ambiguous', () => {
  assert.equal(p(''), null);
  assert.equal(p('   '), null);
  assert.equal(p('такси'), null);
  assert.equal(p('0 такси'), null);
  assert.equal(p('такси 0,00'), null);
  assert.equal(p('1.234 такси'), null); // three decimals: not an amount (same as parseAmount)
  assert.equal(p('1,234 taxi', en), null);
  assert.equal(p('такси 100 200 кофе 5'), null);
  assert.equal(p('ужин на 4 человек 3000'), null); // two numbers
  assert.equal(p('iphone15'), null);
  assert.equal(p('99999999999999999999 x'), null);
});

test('currency by symbol', () => {
  assert.equal(p('50 € ужин')?.currency, 'EUR');
  assert.equal(p('ужин €50')?.currency, 'EUR');
  assert.equal(p('$20 uber', en)?.currency, 'USD');
  assert.equal(p('taxi 20$', { lang: 'en', groupCurrency: 'EUR' })?.currency, 'USD');
  assert.equal(p('£12 pub', en)?.currency, 'GBP');
  assert.equal(p('30₾ вино')?.currency, 'GEL');
  assert.equal(p('5000 ₸ такси')?.currency, 'KZT');
  assert.equal(p('2000֏ кофе')?.currency, 'AMD');
  assert.equal(p('100 ₺ чай')?.currency, 'TRY');
  assert.equal(p('¥50 ramen', en)?.currency, 'CNY');
  assert.equal(p('1500 ₽ ужин', { lang: 'ru', groupCurrency: 'EUR' })?.currency, 'RUB');
  assert.equal(p('1500 ₽ ужин')?.title, 'ужин');
});

test('currency by code and word', () => {
  assert.deepEqual(p('ужин 50 eur'), { title: 'ужин', amount: 5000, currency: 'EUR', category: 'food' });
  assert.equal(p('ужин 50 EUR')?.currency, 'EUR');
  assert.equal(p('usd 30 hotel', en)?.currency, 'USD');
  assert.equal(p('hotel 30 Usd', en)?.title, 'hotel');
  assert.equal(p('такси 100 gel')?.currency, 'GEL');
  assert.equal(p('1200 руб такси')?.currency, 'RUB');
  assert.equal(p('1200 руб. такси')?.title, 'такси');
  const usd: O = { lang: 'ru', groupCurrency: 'USD' };
  assert.equal(p('1200р такси', usd)?.currency, 'RUB');
  assert.equal(p('1200 р. такси', usd)?.currency, 'RUB');
  assert.equal(p('такси 1200 рублей', usd)?.currency, 'RUB');
  assert.equal(p('ужин 40 евро')?.currency, 'EUR');
  assert.equal(p('отель 100 долл')?.currency, 'USD');
  assert.equal(p('отель 100 долларов')?.currency, 'USD');
  assert.equal(p('50 лари вино')?.currency, 'GEL');
  assert.equal(p('50 euros dinner', en)?.currency, 'EUR');
  assert.equal(p('50 dollars dinner', { lang: 'en', groupCurrency: 'EUR' })?.currency, 'USD');
  assert.equal(p('30 грн кофе')?.currency, 'UAH');
});

test('a currency-like prefix of a normal word is not a currency', () => {
  const r = p('100 батон');
  assert.equal(r?.currency, 'RUB');
  assert.equal(r?.title, 'батон');
  const q = p('20 trams', en);
  assert.equal(q?.currency, 'USD');
  assert.equal(q?.title, 'trams');
});

test('title cleanup and fallback', () => {
  assert.equal(p('такси за 1200')?.title, 'такси');
  assert.equal(p('1200 - такси')?.title, 'такси');
  assert.equal(p('dinner for 50', en)?.title, 'dinner');
  assert.deepEqual(p('1200'), { title: 'Другое', amount: 120000, currency: 'RUB', category: 'other' });
  assert.deepEqual(p('$15', en), { title: 'Other', amount: 1500, currency: 'USD', category: 'other' });
  assert.equal(p(`${'x'.repeat(150)} 5`)?.title.length, 100);
});

test('categories in both languages', () => {
  assert.equal(p('uber 15', en)?.category, 'transport');
  assert.equal(p('groceries 80', en)?.category, 'groceries');
  assert.equal(p('продукты 3400')?.category, 'groceries');
  assert.equal(p('что-то 10')?.category, 'other');
});
