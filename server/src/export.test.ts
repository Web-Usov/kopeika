import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCsv, csvAmount, csvField, exportFileName } from './export.ts';

// biome-ignore lint/suspicious/noExplicitAny: minimal fixture of the group detail
const group: any = {
  currency: 'RUB',
  members: [
    { id: 1, name: 'Аня', balance: 5000 },
    { id: 2, name: 'Боря "Бо"; Иванов', balance: -5000 },
  ],
  expenses: [
    {
      id: 2,
      kind: 'transfer',
      title: 'Перевод',
      amount: 1000,
      payerId: 2,
      spentOn: '2025-01-16',
      category: null,
      shares: [{ memberId: 1, amount: 1000 }],
    },
    {
      id: 1,
      kind: 'expense',
      title: 'Ужин; с вином',
      amount: 150050,
      payerId: 1,
      spentOn: '2025-01-15',
      category: 'food',
      shares: [
        { memberId: 1, amount: 75025 },
        { memberId: 2, amount: 75025 },
      ],
    },
  ],
};

test('csvField quotes separators, quotes and line breaks', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('a;b'), '"a;b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('a\nb'), '"a\nb"');
});

test('csvAmount uses a comma in ru and a dot in en, no grouping', () => {
  assert.equal(csvAmount(150050, 'ru'), '1500,50');
  assert.equal(csvAmount(150050, 'en'), '1500.50');
  assert.equal(csvAmount(5, 'en'), '0.05');
  assert.equal(csvAmount(-5000, 'ru'), '-50,00');
});

test('buildCsv (ru): BOM, ; separator, CRLF, headers, rows sorted by date', () => {
  const csv = buildCsv(group, 'ru');
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], 'Дата;Название;Тип;Категория;Сумма;Валюта;Кто платил;Аня;"Боря ""Бо""; Иванов"');
  assert.match(lines[1] ?? '', /^2025-01-15;"Ужин; с вином";Трата;.+;1500,50;RUB;Аня;750,25;750,25$/);
  assert.equal(lines[2], '2025-01-16;Перевод;Перевод;;10,00;RUB;"Боря ""Бо""; Иванов";10,00;');
  assert.equal(lines[3], '');
  assert.equal(lines[4], ';Итого заплатил(а);;;;RUB;;1500,50;10,00');
  assert.equal(lines[5], ';Итого доля;;;;RUB;;760,25;750,25');
  assert.equal(lines[6], ';Баланс;;;;RUB;;50,00;-50,00');
  assert.ok(csv.endsWith('\r\n'));
});

test('buildCsv (en): English headers and dot decimals', () => {
  const lines = buildCsv(group, 'en').slice(1).split('\r\n');
  assert.ok(lines[0]?.startsWith('Date;Title;Type;Category;Amount;Currency;Paid by;'));
  assert.ok(lines[1]?.includes(';Expense;'));
  assert.ok(lines[1]?.includes(';1500.50;RUB;'));
});

test('buildCsv neutralises formula injection in titles', () => {
  const g = { ...group, expenses: [{ ...group.expenses[1], title: '=SUM(A1)' }] };
  assert.ok(buildCsv(g, 'en').includes(";'=SUM(A1);"));
});

test('exportFileName is safe and never empty', () => {
  assert.equal(exportFileName('Поездка в Сочи'), 'Поездка в Сочи.csv');
  assert.equal(exportFileName('../../etc/passwd'), 'etcpasswd.csv');
  assert.equal(exportFileName('🎉🎉'), 'kopeika-export.csv');
});
