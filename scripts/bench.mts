// Benchmark of the balance paths on synthetic data. Not part of CI:
//   npx tsx scripts/bench.mts            (BENCH_GROUPS / BENCH_EXPENSES / BENCH_MEMBERS to resize)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GROUPS = Number(process.env.BENCH_GROUPS ?? 50);
const EXPENSES = Number(process.env.BENCH_EXPENSES ?? 1000);
const MEMBERS = Number(process.env.BENCH_MEMBERS ?? 6);
const RUNS = Number(process.env.BENCH_RUNS ?? 7);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kopeika-bench-'));
process.env.DB_PATH = path.join(dir, 'bench.db');
process.env.DEV_AUTH = '1';
delete process.env.BOT_TOKEN;

const { computeShares } = await import('../shared/money.ts');
const { CATEGORY_IDS } = await import('../shared/categories.ts');
const { db, one } = await import('../server/src/db.ts');
const { api } = await import('../server/src/api.ts');
const repo = await import('../server/src/repo.ts');
const { buildInlineResults } = await import('../server/src/inline.ts');
const { balanceText, privateBalanceText } = await import('../server/src/chatText.ts');

// Deterministic PRNG so runs are comparable.
let seed = 12345;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const int = (n: number) => Math.floor(rnd() * n);

const USER = 1;
db.prepare('INSERT INTO users (id, first_name) VALUES (?, ?)').run(USER, 'Bench');
const modes = ['equal', 'shares', 'exact'] as const;
let firstGroup = 0;
db.exec('BEGIN');
for (let g = 0; g < GROUPS; g++) {
  const gid = Number(
    db
      .prepare('INSERT INTO groups (name, currency, invite_code, created_by) VALUES (?, ?, ?, ?)')
      .run(`Группа ${g}`, 'RUB', `inv${g}`, USER).lastInsertRowid,
  );
  if (!firstGroup) firstGroup = gid;
  const ids: number[] = [];
  for (let m = 0; m < MEMBERS; m++) {
    const r = db
      .prepare('INSERT INTO members (group_id, user_id, name) VALUES (?, ?, ?)')
      .run(gid, m === 0 ? USER : null, `Участник ${m}`);
    ids.push(Number(r.lastInsertRowid));
  }
  for (let e = 0; e < EXPENSES; e++) {
    const transfer = e % 20 === 19;
    const amount = 100 + int(500000);
    const payer = ids[int(MEMBERS)];
    let mode: (typeof modes)[number] = modes[int(3)];
    let parts = ids.filter(() => rnd() < 0.7);
    if (parts.length === 0) parts = [ids[0]];
    if (transfer) {
      mode = 'exact';
      parts = [ids[(ids.indexOf(payer) + 1) % MEMBERS]];
    }
    const inputs = parts.map((memberId) => ({
      memberId,
      value: mode === 'equal' ? 1 : mode === 'shares' ? 1 + int(4) : 0,
    }));
    if (transfer) inputs[0].value = amount;
    else if (mode === 'exact') {
      let left = amount;
      inputs.forEach((i, idx) => {
        i.value = idx === inputs.length - 1 ? left : Math.floor(left / 2);
        left -= i.value;
      });
    }
    const shares = computeShares(amount, mode, inputs);
    const foreign = e % 7 === 0;
    const id = Number(
      db
        .prepare(
          `INSERT INTO expenses (group_id, kind, title, amount, payer_id, split_mode, spent_on, category, original_amount, original_currency, rate, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          gid,
          transfer ? 'transfer' : 'expense',
          `Трата ${e}`,
          amount,
          payer,
          mode,
          `2025-${String(1 + (e % 12)).padStart(2, '0')}-${String(1 + (e % 28)).padStart(2, '0')}`,
          CATEGORY_IDS[int(CATEGORY_IDS.length)],
          foreign ? Math.round(amount / 90) : null,
          foreign ? 'USD' : null,
          foreign ? '90' : null,
          USER,
        ).lastInsertRowid,
    );
    for (const inp of inputs)
      db.prepare('INSERT INTO expense_shares (expense_id, member_id, input, amount) VALUES (?, ?, ?, ?)').run(
        id,
        inp.memberId,
        inp.value,
        shares.get(inp.memberId) ?? 0,
      );
  }
}
db.exec('COMMIT');
const count = one<{ n: number }>('SELECT COUNT(*) AS n FROM expenses')?.n;
console.log(`Data: ${GROUPS} groups x ${EXPENSES} expenses x ${MEMBERS} members = ${count} expenses`);

const headers = { Authorization: `dev ${USER}` };
const opts = { groupLink: (c: string) => `https://t.me/x?startapp=${c}`, botLink: null };
const results: [string, number][] = [];

async function bench(name: string, fn: () => unknown | Promise<unknown>) {
  await fn(); // warm-up
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    await fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  results.push([name, times[Math.floor(times.length / 2)]]);
}

await bench('GET /api/groups', async () => {
  const r = await api.request('/groups', { headers });
  await r.json();
});
await bench('GET /api/groups/:id', async () => {
  const r = await api.request(`/groups/${firstGroup}`, { headers });
  await r.json();
});
await bench('inline results (20 cards)', () => buildInlineResults('ru', repo.inlineGroupsForUser(USER), '', opts));
await bench('/balance private (all groups)', () =>
  privateBalanceText(
    'ru',
    repo.groupsForUser(USER).filter((g) => !g.archived),
  ),
);
await bench('/balance in group chat', () => {
  const group = one<import('../server/src/repo.ts').GroupRow>('SELECT * FROM groups WHERE id = ?', firstGroup);
  if (!group) throw new Error('no group');
  const snap = repo.groupBalanceSnapshot(group);
  const names = new Map(snap.members.map((m) => [m.id, m.name]));
  return balanceText('ru', {
    groupName: group.name,
    currency: group.currency,
    totalSpent: snap.totalSpent,
    members: snap.members,
    settlements: snap.settlements.map((s) => ({
      from: names.get(s.from) ?? '',
      to: names.get(s.to) ?? '',
      amount: s.amount,
    })),
  });
});

console.log(`\n| scenario | median of ${RUNS}, ms |\n|---|---:|`);
for (const [n, ms] of results) console.log(`| ${n} | ${ms.toFixed(1)} |`);
fs.rmSync(dir, { recursive: true, force: true });
