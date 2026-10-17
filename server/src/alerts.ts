// Alerts to the owner (ADMIN_USER_IDS) about errors: server 5xx, fatal process errors, errors reported by the app.
// Same error (source + message + first stack line) is one group: the first occurrence is sent at once, later ones
// at most once an hour with a count. All groups together: at most MAX_PER_HOUR messages an hour.
// Texts carry no personal data: only the error message (cut), a code location and the version.
import { GrammyError, HttpError } from 'grammy';
import { z } from 'zod';
import type { TFn } from '../../shared/i18n/index.ts';
import { alertAdmins, canAlertAdmins } from './bot.ts';
import { config } from './config.ts';
import { describeTelegramError } from './logging.ts';
import { version } from './version.ts';

export const HOUR_MS = 60 * 60 * 1000;
export const MAX_ALERTS_PER_HOUR = 20;
const MAX_GROUPS = 200;
const MAX_TEXT = 300;

export interface ErrorEvent {
  source: 'server' | 'client';
  message: string;
  /** Where it happened: first stack line (server) or route + platform (client). */
  at: string;
  version: string;
}

export interface AlertMessage extends ErrorEvent {
  /** Occurrences since the previous message (1 for the first one). */
  count: number;
  first: boolean;
}

export interface AlerterDeps {
  now?: () => number;
  enabled?: () => boolean;
  canSend?: () => boolean;
  send: (m: AlertMessage) => Promise<void>;
}

export function createAlerter(deps: AlerterDeps) {
  const now = deps.now ?? Date.now;
  const enabled = deps.enabled ?? (() => true);
  const canSend = deps.canSend ?? (() => true);
  const groups = new Map<string, { alertedAt: number | null; pending: number }>();
  let sentAt: number[] = [];

  return {
    /** Registers an occurrence; resolves when the message (if any) has been handed to Telegram. Never throws. */
    async report(ev: ErrorEvent): Promise<void> {
      try {
        if (!enabled() || !canSend()) return;
        const t = now();
        const key = `${ev.source}\n${ev.message}\n${ev.at.split('\n')[0]}`;
        const g = groups.get(key) ?? { alertedAt: null, pending: 0 };
        groups.delete(key);
        groups.set(key, g); // most recently seen goes last
        if (groups.size > MAX_GROUPS) groups.delete(groups.keys().next().value!);
        g.pending++;
        const first = g.alertedAt === null;
        if (!first && t - g.alertedAt! < HOUR_MS) return;
        sentAt = sentAt.filter((s) => t - s < HOUR_MS);
        if (sentAt.length >= MAX_ALERTS_PER_HOUR) return; // counted, told later
        const count = g.pending;
        g.alertedAt = t;
        g.pending = 0;
        sentAt.push(t);
        await deps.send({ ...ev, count, first });
      } catch (e) {
        console.warn('error alert failed:', e instanceof Error ? e.message : e);
      }
    },
    reset() {
      groups.clear();
      sentAt = [];
    },
  };
}

export function alertText(t: TFn, m: AlertMessage): string {
  const where = t(m.source === 'server' ? 'bot.errorWhereServer' : 'bot.errorWhereClient');
  const text = t('bot.errorAlert', { where, message: m.message, at: m.at, version: m.version });
  return (m.first ? text : text + t('bot.errorAlertRepeat', { count: m.count })).slice(0, 1000);
}

export const alerter = createAlerter({
  enabled: () => config.errorAlerts,
  canSend: canAlertAdmins,
  send: (m) => alertAdmins((t) => alertText(t, m)),
});

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A short, safe description of a server error. An error message may quote request data (e.g. a JSON parse error), so only known shapes keep it. */
export function describeServerError(err: unknown): { message: string; at: string } {
  if (err instanceof GrammyError || err instanceof HttpError) {
    return { message: describeTelegramError(err).slice(0, MAX_TEXT), at: 'telegram' };
  }
  if (err instanceof z.ZodError) return { message: 'ZodError', at: 'validation' };
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'non-error thrown');
  const message = e instanceof SyntaxError ? 'SyntaxError (invalid input)' : `${e.name}: ${oneLine(e.message)}`;
  const frame = e.stack?.split('\n').find((l) => l.trim().startsWith('at '));
  return { message: message.slice(0, MAX_TEXT), at: oneLine(frame ?? 'no stack').slice(0, MAX_TEXT) };
}

/** An unhandled server error (5xx or fatal). */
export function reportServerError(err: unknown): Promise<void> {
  return alerter.report({ source: 'server', ...describeServerError(err), version });
}

/**
 * The process had an unhandled rejection or an uncaught exception. Node's default is to print it and exit with
 * code 1; that stays: after the owner is told (waiting a few seconds at most) the process exits with 1 and the
 * container restarts. Continuing after such an error can leave the process in a broken state.
 */
export function installProcessHandlers(proc: NodeJS.Process = process, exit: (code: number) => void = process.exit) {
  let dying = false;
  const fatal = (kind: string) => async (err: unknown) => {
    if (dying) return;
    dying = true;
    console.error(kind, err);
    await Promise.race([reportServerError(err), new Promise((r) => setTimeout(r, 3000).unref())]);
    exit(1);
  };
  proc.on('uncaughtException', fatal('uncaughtException'));
  proc.on('unhandledRejection', fatal('unhandledRejection'));
}
