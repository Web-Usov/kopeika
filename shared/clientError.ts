// Error reports from the Mini App (POST /api/client-errors). Shared by the client (what it may send) and
// the server (what it accepts), so both scrub the same way. A report holds no personal data: no initData,
// names, amounts or expense text, no query strings.

export const CLIENT_ERROR_LIMITS = { message: 300, stack: 1200, route: 100, short: 40 } as const;
export const STACK_LINES = 5;

/** Words that may stay in a route pattern; anything else becomes "?". */
const ROUTE_WORDS = new Set([
  'privacy',
  'terms',
  'new',
  'link',
  'join',
  'g',
  'settings',
  'summary',
  'receipt',
  'expense',
  'transfer',
]);

/**
 * "/g/12/expense/345?x=1" -> "/g/:id/expense/:eid": no ids, codes, tokens or query.
 * Already-shortened patterns stay as they are.
 */
export function routePattern(hashOrPath: string): string {
  const path = (hashOrPath.split('?')[0] ?? '').replace(/^#/, '');
  const parts = path.split('/').filter(Boolean);
  const out = parts.map((part, i) => {
    if (part.startsWith(':')) return /^:[a-z]{1,8}$/.test(part) ? part : '?';
    if (ROUTE_WORDS.has(part)) return part;
    const prev = parts[i - 1];
    if (prev === 'g' && /^\d+$/.test(part)) return ':id';
    if ((prev === 'expense' || prev === 'transfer') && /^\d+$/.test(part)) return ':eid';
    if (prev === 'join') return ':code';
    if (prev === 'link') return ':token';
    return '?';
  });
  return `/${out.join('/')}`.slice(0, CLIENT_ERROR_LIMITS.route);
}

/** Drops what could identify a person or a session: query/hash parts of URLs, Telegram launch params. */
export function scrubText(s: string): string {
  return s
    .replace(/(https?:\/\/[^\s)'"]*?)[?#][^\s)'"]*/g, '$1')
    .replace(/tgWebApp\w*=[^\s&)'"]*/gi, 'tgWebApp=…')
    .replace(/\b(?:hash|query_id|auth_date|signature|initData)=[^\s&)'"]*/gi, '…')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** The first few lines of a stack, scrubbed and cut. */
export function stackHead(
  stack: string | undefined,
  lines = STACK_LINES,
  max: number = CLIENT_ERROR_LIMITS.stack,
): string {
  if (!stack) return '';
  return stack
    .split('\n')
    .slice(0, lines)
    .map((l) => scrubText(l))
    .join('\n')
    .slice(0, max);
}
