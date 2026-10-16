// CSV export of a group: UTF-8 with BOM, ";" separator and CRLF so Excel opens it without the import wizard.
import { type CategoryId, categoryKey } from '../../shared/categories.ts';
import { createT, type Key, type Lang } from '../../shared/i18n/index.ts';
import type { groupDetail } from './repo.ts';

type Detail = ReturnType<typeof groupDetail>;

const BOM = '﻿';

/** Quotes a field when it holds a separator, quote or line break; quotes are doubled. */
export function csvField(v: string): string {
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Minor units → plain decimal ("1500,50" in ru, "1500.50" in en), no thousands separators. */
export function csvAmount(minor: number, lang: Lang): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${Math.trunc(abs / 100)}${lang === 'ru' ? ',' : '.'}${frac}`;
}

/** Spreadsheets treat a leading = + - @ as a formula; neutralise user text that starts with one. */
const text = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

export function buildCsv(g: Detail, lang: Lang): string {
  const t = createT(lang);
  const amt = (v: number) => csvAmount(v, lang);
  const nameOf = new Map(g.members.map((m) => [m.id, m.name]));
  const rows: string[][] = [
    [
      t('export.date'),
      t('export.title'),
      t('export.type'),
      t('export.category'),
      t('export.amount'),
      t('export.currency'),
      t('export.paidBy'),
      ...g.members.map((m) => text(m.name)),
    ],
  ];
  const paid = new Map<number, number>();
  const share = new Map<number, number>();
  for (const e of [...g.expenses].sort((a, b) => a.spentOn.localeCompare(b.spentOn) || a.id - b.id)) {
    const byMember = new Map(e.shares.map((s) => [s.memberId, s.amount]));
    paid.set(e.payerId, (paid.get(e.payerId) ?? 0) + e.amount);
    for (const s of e.shares) share.set(s.memberId, (share.get(s.memberId) ?? 0) + s.amount);
    rows.push([
      e.spentOn,
      text(e.title),
      t(e.kind === 'transfer' ? 'export.transfer' : 'export.expense'),
      e.kind === 'expense' && e.category ? t(categoryKey(e.category as CategoryId)) : '',
      amt(e.amount),
      g.currency,
      text(nameOf.get(e.payerId) ?? ''),
      ...g.members.map((m) => (byMember.has(m.id) ? amt(byMember.get(m.id) ?? 0) : '')),
    ]);
  }
  const total = (label: Key, value: (id: number) => number) => [
    '',
    t(label),
    '',
    '',
    '',
    g.currency,
    '',
    ...g.members.map((m) => amt(value(m.id))),
  ];
  rows.push(
    [],
    total('export.totalPaid', (id) => paid.get(id) ?? 0),
  );
  rows.push(total('export.totalShare', (id) => share.get(id) ?? 0));
  rows.push(total('export.totalBalance', (id) => g.members.find((m) => m.id === id)?.balance ?? 0));
  return `${BOM}${rows.map((r) => r.map(csvField).join(';')).join('\r\n')}\r\n`;
}

/** File name from the group name: no path/reserved characters, never empty. */
export function exportFileName(groupName: string): string {
  const base = groupName
    .replace(/[^\p{L}\p{N} ._-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 60)
    .trim();
  return `${base || 'kopeika-export'}.csv`;
}
