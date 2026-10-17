import { createT, pickLang } from '../../shared/i18n/index.ts';
import { canDm, dm } from './bot.ts';
import { config } from './config.ts';
import { one, run } from './db.ts';
import { logTelegramError } from './logging.ts';
import { localDate } from './recurring.ts';
import { buildStatsReport, collectStats } from './stats.ts';

const CHECK_EVERY_MS = 30 * 60 * 1000;
/** Local hour from which Monday's report may go out. */
export const WEEKLY_HOUR = 9;
const STATE_KEY = 'stats_weekly_last';

/** Due on Monday (server-local) from the morning hour on, once per Monday: `lastDate` is the Monday it last went out. */
export function isWeeklyDue(now: Date, lastDate: string | null): boolean {
  return now.getDay() === 1 && now.getHours() >= WEEKLY_HOUR && localDate(now) !== lastDate;
}

type Send = (userId: number, text: string) => Promise<unknown>;

/**
 * Sends the stats report to every admin if it is due. Skips silently while the bot is not ready (nothing is marked,
 * so the next check retries). The Monday is marked in app_state before sending, so a restart the same day never
 * sends it twice. Returns how many admins were messaged.
 */
export async function runWeeklyStats(
  now: Date,
  opts: { enabled?: boolean; admins?: Set<number>; ready?: boolean; send?: Send } = {},
): Promise<number> {
  const enabled = opts.enabled ?? config.statsWeekly;
  const admins = opts.admins ?? config.adminUserIds;
  const ready = opts.ready ?? canDm();
  const send: Send = opts.send ?? ((id, text) => dm(id, text));
  if (!enabled || admins.size === 0 || !ready) return 0;
  const last = one<{ value: string }>('SELECT value FROM app_state WHERE key = ?', STATE_KEY)?.value ?? null;
  if (!isWeeklyDue(now, last)) return 0;
  run(
    'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    STATE_KEY,
    localDate(now),
  );
  const snapshot = collectStats(now);
  for (const id of admins) {
    const lang = pickLang(one<{ lang: string | null }>('SELECT lang FROM users WHERE id = ?', id)?.lang);
    await send(id, `${createT(lang)('stats.weeklyTitle')}\n\n${buildStatsReport(lang, snapshot)}`);
  }
  return admins.size;
}

async function safeRun() {
  try {
    await runWeeklyStats(new Date());
  } catch (e) {
    logTelegramError('Weekly stats failed', e);
  }
}

/** Checks every half hour (robust to restarts); the check is idempotent per Monday. */
export function startStatsWeeklySchedule() {
  if (config.dbPath === ':memory:') return;
  void safeRun();
  setInterval(() => void safeRun(), CHECK_EVERY_MS).unref();
}
