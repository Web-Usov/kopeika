import './test-env.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeBalances, computeShares, type SplitMode, settleUp } from '../../shared/money.ts';
import { all, db } from './db.ts';
import { type GroupRow, groupBalanceSnapshot, groupBalances, groupsForUser, inlineGroupsForUser } from './repo.ts';

// Seeded PRNG: a failure reproduces.
let seed = 20240607;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const int = (n: number) => Math.floor(rnd() * n);

/** The reference: balances the old way, from every expense and share row via shared/money.ts. */
function referenceBalances(groupId: number) {
  const ids = all<{ id: number }>('SELECT id FROM members WHERE group_id = ?', groupId).map((m) => m.id);
  const entries = all<{ id: number; payer_id: number; amount: number }>(
    'SELECT id, payer_id, amount FROM expenses WHERE group_id = ?',
    groupId,
  ).map((e) => ({
    payerId: e.payer_id,
    amount: e.amount,
    shares: all<{ member_id: number; amount: number }>(
      'SELECT member_id, amount FROM expense_shares WHERE expense_id = ?',
      e.id,
    ).map((s) => ({ memberId: s.member_id, amount: s.amount })),
  }));
  return computeBalances(ids, entries);
}

test('SQL balances equal computeBalances on random groups', () => {
  const insUser = db.prepare('INSERT INTO users (id, first_name) VALUES (?, ?)');
  const insGroup = db.prepare('INSERT INTO groups (name, currency, invite_code, created_by) VALUES (?, ?, ?, ?)');
  const insMember = db.prepare('INSERT INTO members (group_id, user_id, name) VALUES (?, ?, ?)');
  const insExpense = db.prepare(
    `INSERT INTO expenses (group_id, kind, title, amount, payer_id, split_mode, spent_on, original_amount, original_currency, rate, created_by)
     VALUES (?, ?, 'x', ?, ?, ?, '2025-01-01', ?, ?, ?, 1)`,
  );
  const insShare = db.prepare('INSERT INTO expense_shares (expense_id, member_id, input, amount) VALUES (?, ?, ?, ?)');
  insUser.run(1, 'Me');

  const groupIds: number[] = [];
  const myMemberOf = new Map<number, number>();
  for (let g = 0; g < 60; g++) {
    const gid = Number(insGroup.run(`G${g}`, 'RUB', `code-${g}`, 1).lastInsertRowid);
    groupIds.push(gid);
    const ids: number[] = [];
    const n = 2 + int(7);
    for (let m = 0; m < n; m++) {
      const r = insMember.run(gid, m === 0 ? 1 : null, `M${m}`);
      ids.push(Number(r.lastInsertRowid));
    }
    myMemberOf.set(gid, ids[0]);
    // Members without any expenses (the "left" ones) are kept on purpose.
    const active = ids.slice(0, Math.max(2, n - int(3)));
    const count = int(40); // includes empty groups
    for (let e = 0; e < count; e++) {
      const transfer = rnd() < 0.15;
      const amount = 1 + int(2_000_000);
      const payer = active[int(active.length)];
      let mode: SplitMode = (['equal', 'shares', 'exact'] as const)[int(3)];
      let parts = active.filter(() => rnd() < 0.6);
      if (parts.length === 0) parts = [active[0]];
      if (transfer) {
        mode = 'exact';
        parts = [active[int(active.length)]];
      }
      const inputs = parts.map((memberId) => ({ memberId, value: mode === 'shares' ? 1 + int(5) : 1 }));
      if (transfer) inputs[0].value = amount;
      else if (mode === 'exact') {
        let left = amount;
        inputs.forEach((i, idx) => {
          i.value = idx === inputs.length - 1 ? left : int(left + 1);
          left -= i.value;
        });
      }
      const shares = computeShares(amount, mode, inputs);
      const foreign = !transfer && rnd() < 0.3; // amounts stay in the group currency, the original is display-only
      const id = Number(
        insExpense.run(
          gid,
          transfer ? 'transfer' : 'expense',
          amount,
          payer,
          mode,
          foreign ? 1 + int(100000) : null,
          foreign ? 'USD' : null,
          foreign ? '91.5' : null,
        ).lastInsertRowid,
      );
      for (const i of inputs) insShare.run(id, i.memberId, i.value, shares.get(i.memberId) ?? 0);
    }
  }

  const list = new Map(groupsForUser(1).map((g) => [g.id, g]));
  const inline = new Map(inlineGroupsForUser(1).map((g) => [g.id, g]));
  assert.equal(list.size, groupIds.length);
  for (const gid of groupIds) {
    const expected = referenceBalances(gid);
    assert.deepEqual(groupBalances(gid), expected, `group ${gid}`);
    const group = all<GroupRow>('SELECT * FROM groups WHERE id = ?', gid)[0];
    const snap = groupBalanceSnapshot(group);
    assert.deepEqual(new Map(snap.members.map((m) => [m.id, m.balance])), expected);
    assert.deepEqual(snap.settlements, settleUp(expected));
    const spent = all<{ amount: number }>("SELECT amount FROM expenses WHERE group_id = ? AND kind = 'expense'", gid);
    assert.equal(
      snap.totalSpent,
      spent.reduce((a, e) => a + e.amount, 0),
    );
    const item = list.get(gid);
    assert.equal(item?.totalSpent, snap.totalSpent);
    assert.equal(item?.membersCount, snap.members.length);
    assert.equal(item?.myBalance, expected.get(myMemberOf.get(gid) ?? 0));
    assert.equal(inline.get(gid)?.snapshot().myBalance, item?.myBalance);
    assert.equal(
      [...expected.values()].reduce((a, b) => a + b, 0),
      0,
    );
  }
});
