/** Что «закрылось» после сохранения: вся группа или только текущий участник. */
export type SettledKind = 'group' | 'me';

interface BalanceView {
  members: { id: number; balance: number }[];
  meId: number;
}

/**
 * Сравнивает балансы до и после сохранения. 'group' — были долги, стали все нули;
 * 'me' — у текущего участника баланс был ненулевым, стал нулевым; иначе null.
 */
export function settledTransition(before: BalanceView | undefined, after: BalanceView): SettledKind | null {
  if (!before) return null;
  const allZero = (g: BalanceView) => g.members.every((m) => m.balance === 0);
  if (!allZero(before) && allZero(after)) return 'group';
  const mine = (g: BalanceView) => g.members.find((m) => m.id === after.meId)?.balance;
  const was = mine(before);
  return was !== undefined && was !== 0 && mine(after) === 0 ? 'me' : null;
}
