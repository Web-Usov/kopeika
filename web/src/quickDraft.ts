// Values from the quick-expense line waiting for the expense form to pick them up ("Изменить" / foreign currency).
// In memory only; the form takes them once when it opens a new expense.
import type { QuickExpense } from '../../shared/quickExpense.ts';

let draft: ({ groupId: number } & QuickExpense) | null = null;

export function setQuickDraft(groupId: number, q: QuickExpense) {
  draft = { groupId, ...q };
}

export function peekQuickDraft(groupId: number): QuickExpense | undefined {
  return draft?.groupId === groupId ? draft : undefined;
}

export function clearQuickDraft() {
  draft = null;
}
