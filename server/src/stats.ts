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
  'join.link',
  'join.card',
  'chat.link',
  'debt.remind',
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
  funnel: Funnel;
}

function toSqlUtc(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export const FUNNEL_PERIODS = [7, 30] as const;
export type FunnelPeriod = (typeof FUNNEL_PERIODS)[number];

export interface FunnelRow {
  /** Groups created in the period (demo groups excluded). */
  created: number;
  /** Of those: at least 2 members with Telegram and at least 3 expenses (transfers do not count). */
  alive: number;
  /** Groups created 14..14+N days ago (old enough to judge) ... */
  returnedOf: number;
  /** ... of which had an expense or a transfer 7..14 days after creation. */
  returned: number;
}
export type Funnel = Record<FunnelPeriod, FunnelRow>;

/**
 * Group funnel by creation date, computed from groups / members / expenses; nothing is stored.
 * created_at columns are UTC. "Returned" needs a group at least 14 days old, so its cohort is shifted back by 14 days:
 * groups created between 14+N and 14 days ago.
 */
export function collectFunnel(now = new Date()): Funnel {
  const at = toSqlUtc(now);
  const funnel = {} as Funnel;
  for (const days of FUNNEL_PERIODS) {
    const since = `-${days} days`;
    const cohort = one<{ created: number; alive: number }>(
      `SELECT COUNT(*) AS created,
              COALESCE(SUM(
                (SELECT COUNT(*) FROM members m WHERE m.group_id = g.id AND m.user_id IS NOT NULL) >= 2
                AND (SELECT COUNT(*) FROM expenses e WHERE e.group_id = g.id AND e.kind = 'expense') >= 3
              ), 0) AS alive
         FROM groups g
        WHERE g.is_demo = 0 AND g.created_at > datetime(?, ?)`,
      at,
      since,
    );
    const ret = one<{ of: number; returned: number }>(
      `SELECT COUNT(*) AS of,
              COALESCE(SUM(EXISTS (
                SELECT 1 FROM expenses e
                 WHERE e.group_id = g.id
                   AND e.created_at > datetime(g.created_at, '+7 days')
                   AND e.created_at <= datetime(g.created_at, '+14 days')
              )), 0) AS returned
         FROM groups g
        WHERE g.is_demo = 0
          AND g.created_at <= datetime(?, '-14 days')
          AND g.created_at > datetime(?, ?)`,
      at,
      at,
      `-${14 + days} days`,
    );
    funnel[days] = {
      created: cohort?.created ?? 0,
      alive: cohort?.alive ?? 0,
      returnedOf: ret?.of ?? 0,
      returned: ret?.returned ?? 0,
    };
  }
  return funnel;
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
    funnel: collectFunnel(now),
  };
}

const percent = (n: number, of: number) => (of === 0 ? '—' : `${Math.round((n / of) * 100)}%`);

/** Plain-text report for the owner: one line per event with today / 7 days / 30 days. */
export function buildStatsReport(lang: Lang, s: StatsSnapshot): string {
  const t = createT(lang);
  const row = (label: string, pick: (p: Period) => number) => `${label}: ${PERIODS.map(pick).join(' · ')}`;
  const lines = [t('stats.title'), t('stats.periods'), ''];
  lines.push(row(t('stats.active'), (p) => s.active[p]));
  for (const e of STAT_EVENTS)
    lines.push(row(t(`stats.event.${e.replace('.', '_')}` as Key), (p) => s.events[p][e] ?? 0));
  lines.push('', t('stats.totals', { users: s.users, groups: s.groups }));
  const f = s.funnel;
  const frow = (label: string, pick: (r: FunnelRow) => string) =>
    `${label}: ${FUNNEL_PERIODS.map((p) => pick(f[p])).join(' · ')}`;
  lines.push('', t('stats.funnel.title'), t('stats.funnel.periods'));
  lines.push(frow(t('stats.funnel.created'), (r) => String(r.created)));
  lines.push(frow(t('stats.funnel.alive'), (r) => `${r.alive} (${percent(r.alive, r.created)})`));
  lines.push(
    frow(t('stats.funnel.returned'), (r) => `${r.returned}/${r.returnedOf} (${percent(r.returned, r.returnedOf)})`),
  );
  lines.push(t('stats.funnel.footer'));
  return lines.join('\n');
}

/** Owner check for /stats. Only a private chat with an admin counts; anywhere else the command is ignored. */
export function canSeeStats(userId: number | undefined, chatType: string, admins: Set<number> = config.adminUserIds) {
  return userId !== undefined && chatType === 'private' && admins.has(userId);
}
