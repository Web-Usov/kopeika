import { z } from 'zod';
import { CATEGORY_IDS } from '../../shared/categories.ts';
import { SplitError } from '../../shared/money.ts';
import { dueDates, isRealDate, isValidDay, type Period } from '../../shared/recurring.ts';
import { notifyExpense } from './bot.ts';
import { config } from './config.ts';
import { all, one, run, tx } from './db.ts';
import { ApiError } from './errors.ts';
import { createExpense, type ExpenseBody } from './expenses.ts';
import { logTelegramError } from './logging.ts';
import type { ExpenseRow, GroupRow } from './repo.ts';

const CHECK_EVERY_MS = 60 * 60 * 1000;

export interface RecurringRow {
  id: number;
  group_id: number;
  created_by: number;
  title: string;
  category: string;
  amount: number;
  payer_id: number;
  split_mode: 'equal' | 'shares' | 'exact';
  shares: string;
  period: Period;
  day: number;
  start_date: string;
  next_date: string;
  active: number;
  created_at: string;
}

type ShareInput = { memberId: number; value: number };

export const recurringShape = {
  title: z.string().trim().min(1).max(100),
  amount: z.number().int().min(1).max(1e12),
  payerId: z.number().int().positive(),
  splitMode: z.enum(['equal', 'shares', 'exact']),
  category: z.enum(CATEGORY_IDS).optional(),
  shares: z
    .array(z.object({ memberId: z.number().int().positive(), value: z.number().int().min(0) }))
    .min(1)
    .max(100),
  period: z.enum(['monthly', 'weekly']),
  day: z.number().int().min(1).max(31),
};

export const isoDate = z.string().refine(isRealDate);

export const scheduleOk = (b: { period: Period; day: number }) => isValidDay(b.period, b.day);

/** Today's calendar date on the server (local time, like the backup schedule). */
export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function recurringDto(r: RecurringRow) {
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    amount: r.amount,
    payerId: r.payer_id,
    splitMode: r.split_mode,
    shares: JSON.parse(r.shares) as ShareInput[],
    period: r.period,
    day: r.day,
    nextDate: r.next_date,
    active: r.active === 1,
    createdBy: r.created_by,
  };
}

/** The expense a template produces for one occurrence date: the same shape the API accepts. */
export function expenseFor(r: RecurringRow, spentOn: string): ExpenseBody {
  return {
    kind: 'expense',
    title: r.title,
    amount: r.amount,
    payerId: r.payer_id,
    splitMode: r.split_mode,
    spentOn,
    category: r.category as ExpenseBody['category'],
    shares: JSON.parse(r.shares) as ShareInput[],
  };
}

/**
 * Creates the expenses that have come due for one template and moves next_date forward, all in one transaction.
 * The update of next_date is a compare-and-set on the old value, so the same occurrence is never created twice,
 * even if two runs overlap or the process restarts in the middle of a day.
 */
function processTemplate(r: RecurringRow, today: string): ExpenseRow[] {
  const group = one<GroupRow>('SELECT * FROM groups WHERE id = ?', r.group_id);
  if (!group) return [];
  const { due, skipped, next } = dueDates({ period: r.period, day: r.day, nextDate: r.next_date }, today);
  // An archived group sleeps: its occurrences pass by without expenses, so they neither pile up nor bring it back.
  if (group.archived_at !== null) {
    run('UPDATE recurring SET next_date = ? WHERE id = ? AND active = 1 AND next_date = ?', next, r.id, r.next_date);
    return [];
  }
  const created = tx(() => {
    const claimed = run(
      'UPDATE recurring SET next_date = ? WHERE id = ? AND active = 1 AND next_date = ?',
      next,
      r.id,
      r.next_date,
    );
    if (claimed.changes === 0) return []; // someone else got there first
    if (skipped > 0) console.warn(`Recurring #${r.id}: skipped ${skipped} missed occurrence(s) before ${due[0]}`);
    const out: ExpenseRow[] = [];
    for (const date of due) {
      try {
        out.push(createExpense(group, r.created_by, expenseFor(r, date), 'ru', true));
      } catch (e) {
        // Validation runs before anything is written, so nothing half-done is left behind.
        if (!(e instanceof ApiError) && !(e instanceof SplitError)) throw e;
        run('UPDATE recurring SET active = 0 WHERE id = ?', r.id);
        console.warn(`Recurring #${r.id} switched off: ${e.message}`);
        break;
      }
    }
    return out;
  });
  if (created.length > 0) {
    const author =
      one<{ name: string }>('SELECT name FROM members WHERE group_id = ? AND user_id = ?', r.group_id, r.created_by)
        ?.name ?? one<{ first_name: string }>('SELECT first_name FROM users WHERE id = ?', r.created_by)?.first_name;
    for (const expense of created) notifyExpense(group, expense, r.created_by, author ?? '');
  }
  return created;
}

/** One scheduler pass: creates everything that is due by `today`. Returns the number of created expenses. */
export function runRecurring(today = localDate()): number {
  const rows = all<RecurringRow>('SELECT * FROM recurring WHERE active = 1 AND next_date <= ? ORDER BY id', today);
  let count = 0;
  for (const r of rows) {
    try {
      count += processTemplate(r, today).length;
    } catch (e) {
      logTelegramError(`Recurring #${r.id} failed`, e);
    }
  }
  if (count > 0) console.log(`Recurring: created ${count} expense(s)`);
  return count;
}

/** Runs at startup (catching up after downtime) and then every hour. */
export function startRecurringSchedule() {
  if (config.dbPath === ':memory:') return;
  runRecurring();
  setInterval(() => runRecurring(), CHECK_EVERY_MS).unref();
}
