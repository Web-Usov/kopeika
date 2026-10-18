import type { CategoryId } from '../../shared/categories.ts';
import { createT, type Lang } from '../../shared/i18n/index.ts';
import type { SplitMode } from '../../shared/money.ts';
import { logActivity } from './activity.ts';
import type { TelegramUser } from './auth.ts';
import { one, run, tx } from './db.ts';
import { createExpense } from './expenses.ts';
import { localDate } from './recurring.ts';
import { displayName, type GroupRow, newInviteCode } from './repo.ts';

/** RUB for Russian, EUR for everyone else; amounts are in minor units of that currency. */
const MONEY = {
  ru: {
    currency: 'RUB',
    rent: 2_400_000,
    groceries: 364_000,
    bbq: 285_000,
    taxi: 120_000,
    tickets: 320_000,
    back: 300_000,
  },
  en: { currency: 'EUR', rent: 24_000, groceries: 4_860, bbq: 3_850, taxi: 1_800, tickets: 4_200, back: 3_000 },
} as const;

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDate(d);
}

/**
 * The demo group of a user: made-up friends and a handful of expenses (different categories and split modes,
 * one transfer), so balances and "who pays whom" have something to show. Created once per user: calling it again
 * returns the existing one (until the user deletes it). Goes through `createExpense`, like real data.
 */
export function createDemoGroup(user: TelegramUser, lang: Lang): { group: GroupRow; created: boolean } {
  const existing = one<GroupRow>(
    'SELECT * FROM groups WHERE is_demo = 1 AND created_by = ? ORDER BY id LIMIT 1',
    user.id,
  );
  if (existing) return { group: existing, created: false };

  const t = createT(lang);
  const m = MONEY[lang];
  return tx(() => {
    const res = run(
      'INSERT INTO groups (name, currency, invite_code, created_by, is_demo) VALUES (?, ?, ?, ?, 1)',
      t('demo.group'),
      m.currency,
      newInviteCode(),
      user.id,
    );
    const groupId = Number(res.lastInsertRowid);
    const addMember = (userId: number | null, name: string) =>
      Number(
        run('INSERT INTO members (group_id, user_id, name) VALUES (?, ?, ?)', groupId, userId, name).lastInsertRowid,
      );
    const me = addMember(user.id, displayName(user));
    const anya = addMember(null, t('demo.anya'));
    const boris = addMember(null, t('demo.boris'));
    const vika = addMember(null, t('demo.vika'));
    logActivity(groupId, user.id, 'group.create', { name: t('demo.group') });
    const group = one<GroupRow>('SELECT * FROM groups WHERE id = ?', groupId)!;

    const equal = (ids: number[]) => ids.map((memberId) => ({ memberId, value: 1 }));
    const add = (
      days: number,
      title: string,
      category: CategoryId,
      amount: number,
      payerId: number,
      splitMode: SplitMode,
      shares: { memberId: number; value: number }[],
    ) =>
      createExpense(
        group,
        user.id,
        { kind: 'expense', title, amount, payerId, splitMode, spentOn: daysAgo(days), category, shares },
        lang,
      );

    // Equal split, weights, exact amounts, a subset of people.
    add(6, t('demo.rent'), 'housing', m.rent, me, 'equal', equal([me, anya, boris, vika]));
    add(5, t('demo.groceries'), 'groceries', m.groceries, anya, 'equal', equal([me, anya, boris, vika]));
    add(4, t('demo.bbq'), 'food', m.bbq, boris, 'shares', [
      { memberId: me, value: 2 },
      { memberId: anya, value: 1 },
      { memberId: boris, value: 2 },
      { memberId: vika, value: 1 },
    ]);
    const taxiAnya = Math.round(m.taxi * 0.6);
    add(3, t('demo.taxi'), 'transport', m.taxi, vika, 'exact', [
      { memberId: anya, value: taxiAnya },
      { memberId: vika, value: m.taxi - taxiAnya },
    ]);
    add(2, t('demo.tickets'), 'fun', m.tickets, me, 'equal', equal([me, anya, vika]));
    createExpense(
      group,
      user.id,
      {
        kind: 'transfer',
        title: t('demo.transfer'),
        amount: m.back,
        payerId: boris,
        splitMode: 'exact',
        spentOn: daysAgo(1),
        shares: [{ memberId: me, value: m.back }],
      },
      lang,
    );
    return { group, created: true };
  });
}
