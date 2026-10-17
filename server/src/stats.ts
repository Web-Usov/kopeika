// Anonymous usage counters: how many times each kind of action happened per day. No user or group ids anywhere here.
import { createT, type Key, type Lang } from '../../shared/i18n/index.ts';
import { DELETED_USER_ID } from './activity.ts';
import { config } from './config.ts';
import { all, one, run } from './db.ts';
import { localDate } from './recurring.ts';

export const STAT_EVENTS = [
  'group.create',
  'group.finish',
  'expense.create',
  'expense.recurring',
  'transfer.create',
  'member.join',
  'member.claim',
  'chat.link',
  'debt.remind',
  'debt.autoremind',
  'export.csv',
  'inline.query',
  'bot.start',
  'user.delete',
  'receipt.scan',
  'receipt.access',
] as const;
export type StatEvent = (typeof STAT_EVENTS)[number];

/**
 * Adds 1 to today's (server-local day) counter. Call it inside the transaction of the action it counts,
 * so a rolled-back action is not counted.
 */
export function countEvent(event: StatEvent, now = new Date()) {
  run(
    `INSERT INTO stats_daily (date, event, count) VALUES (?, ?, 1)
     ON CONFLICT(date, event) DO UPDATE SET count = count + 1`,
    localDate(now),
    event,
  );
}

/** For places outside a transaction: counting must never break the action itself. */
export function countEventSafe(event: StatEvent) {
  try {
    countEvent(event);
  } catch (e) {
    console.warn('countEvent failed', e instanceof Error ? e.message : e);
  }
}

export const PERIODS = [1, 7, 30] as const;
export type Period = (typeof PERIODS)[number];

export interface StatsSnapshot {
  /** Per period (days back, including today): event -> count. */
  events: Record<Period, Partial<Record<StatEvent, number>>>;
  /** Users seen in the last 1 / 7 / 30 days, counted from users.updated_at (no ids are stored for this). */
  active: Record<Period, number>;
  users: number;
  groups: number;
}

function toSqlUtc(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function collectStats(now = new Date()): StatsSnapshot {
  const events = {} as StatsSnapshot['events'];
  const active = {} as StatsSnapshot['active'];
  for (const days of PERIODS) {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
    const rows = all<{ event: StatEvent; total: number }>(
      'SELECT event, SUM(count) AS total FROM stats_daily WHERE date >= ? GROUP BY event',
      localDate(from),
    );
    events[days] = Object.fromEntries(rows.map((r) => [r.event, r.total]));
    // updated_at is UTC and is bumped on every authenticated request and bot interaction (see upsertUser).
    active[days] =
      one<{ n: number }>(
        'SELECT COUNT(*) AS n FROM users WHERE id != ? AND updated_at >= datetime(?, ?)',
        DELETED_USER_ID,
        toSqlUtc(now),
        `-${days} days`,
      )?.n ?? 0;
  }
  return {
    events,
    active,
    users: one<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE id != ?', DELETED_USER_ID)?.n ?? 0,
    groups: one<{ n: number }>('SELECT COUNT(*) AS n FROM groups WHERE is_demo = 0')?.n ?? 0,
  };
}

/** Plain-text report for the owner: one line per event with today / 7 days / 30 days. */
export function buildStatsReport(lang: Lang, s: StatsSnapshot): string {
  const t = createT(lang);
  const row = (label: string, pick: (p: Period) => number) => `${label}: ${PERIODS.map(pick).join(' · ')}`;
  const lines = [t('stats.title'), t('stats.periods'), ''];
  lines.push(row(t('stats.active'), (p) => s.active[p]));
  for (const e of STAT_EVENTS)
    lines.push(row(t(`stats.event.${e.replace('.', '_')}` as Key), (p) => s.events[p][e] ?? 0));
  lines.push('', t('stats.totals', { users: s.users, groups: s.groups }));
  return lines.join('\n');
}

/** Owner check for /stats. Only a private chat with an admin counts; anywhere else the command is ignored. */
export function canSeeStats(userId: number | undefined, chatType: string, admins: Set<number> = config.adminUserIds) {
  return userId !== undefined && chatType === 'private' && admins.has(userId);
}
