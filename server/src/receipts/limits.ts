// Who may scan receipts and how much it has cost (#102). Money is counted in micro-dollars (integers).
// A group without the `receipts` right gets RECEIPTS_GROUP_TRIAL_MONTHLY free scans per calendar month (server-local);
// a right (given by the owner now, by Stars Premium later) removes that limit. Both are capped by a global monthly budget.
import { config } from '../config.ts';
import { one, run, tx } from '../db.ts';
import { countEvent } from '../stats.ts';
import type { ReceiptUsage } from './provider.ts';

const MICRO = 1_000_000;

/** First instant of the calendar month containing `now`, server-local, as a UTC ISO string. */
export const monthStart = (now: Date) => new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
/** First instant of the next month: when the monthly counters reset. */
export const nextMonthStart = (now: Date) => new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
const monthKey = (now: Date) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

/** Cost of one provider call in micro-dollars, rounded up: $/1M tokens equals micro-dollars per token. */
export function costMicroUsd(usage: Pick<ReceiptUsage, 'inputTokens' | 'outputTokens'>): number {
  return Math.ceil(
    usage.inputTokens * config.receiptsPriceInUsdPerM + usage.outputTokens * config.receiptsPriceOutUsdPerM,
  );
}

/** Is there a live `receipts` right (not expired) for the group? */
export function hasReceiptsEntitlement(groupId: number, now = new Date()): boolean {
  const row = one<{ expires_at: string | null }>(
    "SELECT expires_at FROM group_entitlements WHERE group_id = ? AND feature = 'receipts'",
    groupId,
  );
  return row !== undefined && (row.expires_at === null || row.expires_at > now.toISOString());
}

export interface ScanQuota {
  unlimited: boolean;
  /** Successful scans of the group in the current month. */
  used: number;
  /** Free scans per month; null when unlimited. */
  limit: number | null;
  /** When `used` goes back to zero (ISO). */
  resetsAt: string;
}

export function scanQuota(groupId: number, now = new Date()): ScanQuota {
  const used =
    one<{ n: number }>(
      'SELECT COUNT(*) AS n FROM receipt_scans WHERE group_id = ? AND counted = 1 AND created_at >= ?',
      groupId,
      monthStart(now),
    )?.n ?? 0;
  const unlimited = hasReceiptsEntitlement(groupId, now);
  return {
    unlimited,
    used,
    limit: unlimited ? null : config.receiptsGroupTrialMonthly,
    resetsAt: nextMonthStart(now),
  };
}

/** `inFlight`: scans of this group running right now (they will count when they succeed). */
export function canScan(groupId: number, now = new Date(), inFlight = 0): boolean {
  const q = scanQuota(groupId, now);
  return q.unlimited || q.used + inFlight < (q.limit ?? 0);
}

/** Spend of the current month, micro-dollars. */
export function monthSpendMicro(now = new Date()): number {
  return (
    one<{ n: number }>(
      'SELECT COALESCE(SUM(cost_micro_usd), 0) AS n FROM receipt_scans WHERE created_at >= ?',
      monthStart(now),
    )?.n ?? 0
  );
}

export const budgetCapMicro = () => Math.round(config.receiptsGlobalMonthlyUsd * MICRO);

/** True when the global monthly budget is used up and scanning is paused. */
export const budgetExhausted = (now = new Date()) => monthSpendMicro(now) >= budgetCapMicro();

export type BudgetNotice = 'warn' | 'stop';
type BudgetNotifier = (kind: BudgetNotice, spentMicro: number, capMicro: number) => void;
let notifier: BudgetNotifier = () => {};
/** The bot registers how the owner is told; tests replace it. */
export function setBudgetNotifier(fn: BudgetNotifier) {
  notifier = fn;
}

/** Marks a threshold as announced for the month; true only the first time. */
function claimNotice(now: Date, kind: BudgetNotice): boolean {
  return run('INSERT OR IGNORE INTO receipt_notices (month, kind) VALUES (?, ?)', monthKey(now), kind).changes === 1;
}

/**
 * Writes the provider calls of one scan to the ledger (only numbers, never content) and counts the scan.
 * `success`: a draft was returned, so the first row counts against the group's quota; failures and "not a receipt"
 * cost money and are recorded, but are free for the group.
 */
export function recordReceiptScan(
  userId: number,
  groupId: number,
  usages: ReceiptUsage[],
  success: boolean,
  now = new Date(),
) {
  if (usages.length === 0) return;
  tx(() => {
    usages.forEach((u, i) => {
      run(
        `INSERT INTO receipt_scans (user_id, group_id, created_at, model, input_tokens, output_tokens, cost_micro_usd, counted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        userId,
        groupId,
        now.toISOString(),
        u.model,
        u.inputTokens,
        u.outputTokens,
        costMicroUsd(u),
        success && i === 0 ? 1 : 0,
      );
    });
    if (success) countEvent('receipt.scan', now);
  });
  const spent = monthSpendMicro(now);
  const cap = budgetCapMicro();
  let kind: BudgetNotice | null = null;
  if (spent >= cap) {
    claimNotice(now, 'warn');
    if (claimNotice(now, 'stop')) kind = 'stop';
  } else if (spent * 10 >= cap * 8 && claimNotice(now, 'warn')) kind = 'warn';
  if (kind) notifier(kind, spent, cap);
}

const groupByCode = (inviteCode: string) =>
  one<{ id: number; name: string }>('SELECT id, name FROM groups WHERE invite_code = ? AND is_demo = 0', inviteCode);

/** Owner command /grant: the group gets the `receipts` right for `days` days (null = no end). Null if no such group. */
export function grantReceipts(inviteCode: string, days: number | null, adminId: number, now = new Date()) {
  const group = groupByCode(inviteCode);
  if (!group) return null;
  const expires = days === null ? null : new Date(now.getTime() + days * 86_400_000).toISOString();
  run(
    `INSERT OR REPLACE INTO group_entitlements (group_id, feature, source, granted_at, expires_at, granted_by)
     VALUES (?, 'receipts', 'admin', ?, ?, ?)`,
    group.id,
    now.toISOString(),
    expires,
    adminId,
  );
  return { ...group, expiresAt: expires };
}

/** Owner command /revoke: removes the right. Null if no such group. */
export function revokeReceipts(inviteCode: string) {
  const group = groupByCode(inviteCode);
  if (!group) return null;
  run("DELETE FROM group_entitlements WHERE group_id = ? AND feature = 'receipts'", group.id);
  return group;
}

// One scan at a time per user; the number running per group is added to the quota check, so parallel
// requests from different members cannot slip past the free limit.
const userBusy = new Set<number>();
const groupInFlight = new Map<number, number>();

/** Reserves the user's single slot; false when a scan of theirs is already running. */
export function acquireScan(userId: number, groupId: number): boolean {
  if (userBusy.has(userId)) return false;
  userBusy.add(userId);
  groupInFlight.set(groupId, (groupInFlight.get(groupId) ?? 0) + 1);
  return true;
}

export function releaseScan(userId: number, groupId: number) {
  userBusy.delete(userId);
  const n = (groupInFlight.get(groupId) ?? 1) - 1;
  if (n <= 0) groupInFlight.delete(groupId);
  else groupInFlight.set(groupId, n);
}

/** Scans of the group running now, not counting the caller's own reservation. */
export const othersInFlight = (groupId: number) => Math.max(0, (groupInFlight.get(groupId) ?? 0) - 1);
