// Tells the server about errors in the app (POST /api/client-errors), so the owner hears about them.
// The report holds the message, the first lines of the stack, the route pattern (no ids, no query/startapp),
// the app version and Telegram's platform/version. Never initData, names, amounts or expense text.
import { CLIENT_ERROR_LIMITS, routePattern, scrubText, stackHead } from '../../shared/clientError.ts';
import { authHeader, tg } from './tg.tsx';

const MAX_REPORTS = 5;
const seen = new Set<string>();
let sent = 0;

export type ErrorKind = 'error' | 'rejection' | 'render';

// Noise that says nothing about our code.
const IGNORED = /ResizeObserver loop|^Script error\.?$|Load failed|Failed to fetch|NetworkError/i;

function describe(e: unknown): { message: string; stack: string } {
  if (e instanceof Error) return { message: `${e.name}: ${e.message}`, stack: e.stack ?? '' };
  if (typeof e === 'string') return { message: e, stack: '' };
  return { message: 'Non-error thrown', stack: '' };
}

export function reportError(error: unknown, kind: ErrorKind): void {
  try {
    const { message: raw, stack: rawStack } = describe(error);
    const message = scrubText(raw).slice(0, CLIENT_ERROR_LIMITS.message);
    if (!message || IGNORED.test(message) || sent >= MAX_REPORTS) return;
    const stack = stackHead(rawStack);
    const key = `${message}\n${stack.split('\n')[1] ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    sent++;
    const body = {
      kind,
      message,
      stack,
      route: routePattern(location.hash),
      version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
      platform: (tg as { platform?: string } | undefined)?.platform ?? 'browser',
      tgVersion: tg?.version ?? '-',
    };
    // Plain fetch, not the API client: a failure here must not produce another error report. Failures are dropped.
    fetch('/api/client-errors', {
      method: 'POST',
      keepalive: true,
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {});
  } catch {
    // reporting must never throw
  }
}

export function installErrorReporting() {
  window.addEventListener('error', (e) => reportError(e.error ?? e.message, 'error'));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'rejection'));
}
