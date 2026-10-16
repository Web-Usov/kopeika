import path from 'node:path';

const env = process.env;

/** "1, 2" -> Set{1, 2}; junk is dropped. */
export function parseAdminIds(raw: string | undefined): Set<number> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
  );
}

/**
 * Reads a numeric env variable: unset/empty -> default; otherwise it must be a finite number
 * in [min, max] (integer if `int`). Anything else throws an error naming the variable.
 */
export function parseNumber(
  name: string,
  raw: string | undefined,
  opts: { default: number; min?: number; max?: number; int?: boolean },
): number {
  if (raw === undefined || raw.trim() === '') return opts.default;
  const n = Number(raw);
  const min = opts.min ?? 1;
  const bad =
    !Number.isFinite(n) || ((opts.int ?? true) ? !Number.isInteger(n) : false) || n < min || n > (opts.max ?? Infinity);
  if (bad) {
    const range = opts.max === undefined ? `>= ${min}` : `${min}..${opts.max}`;
    throw new Error(
      `Invalid config: ${name}="${raw}" must be ${(opts.int ?? true) ? 'an integer' : 'a number'} ${range}`,
    );
  }
  return n;
}

/** Throws if DEV_AUTH would run in production (unless the CI-only escape hatch is set). */
export function checkDevAuth(e: Record<string, string | undefined>): void {
  if (e.NODE_ENV === 'production' && e.DEV_AUTH === '1' && e.ALLOW_DEV_AUTH_IN_PRODUCTION !== '1') {
    throw new Error(
      'Refusing to start: DEV_AUTH=1 with NODE_ENV=production lets anyone act as any user. ' +
        'Remove DEV_AUTH (set ALLOW_DEV_AUTH_IN_PRODUCTION=1 only in CI smoke tests).',
    );
  }
}

checkDevAuth(env);

export const config = {
  port: parseNumber('PORT', env.PORT, { default: 3000, max: 65535 }),
  botToken: env.BOT_TOKEN ?? '',
  /** Public HTTPS URL of the Mini App, e.g. https://kopeika.usov-home.ru */
  appUrl: env.APP_URL ?? '',
  /** Short name given to the Mini App in @BotFather (/newapp); used for t.me/<bot>/<short> links. */
  appShortName: env.APP_SHORT_NAME ?? '',
  /** Timeout of every Telegram Bot API request, seconds. grammY's default is 500. */
  telegramTimeoutSec: parseNumber('TELEGRAM_TIMEOUT_SEC', env.TELEGRAM_TIMEOUT_SEC, { default: 20, max: 3600 }),
  /** Custom Bot API address (proxy or self-hosted Bot API server); empty = https://api.telegram.org */
  telegramApiRoot: env.TELEGRAM_API_ROOT ?? '',
  dbPath: env.DB_PATH ?? path.resolve('data/kopeika.db'),
  /** Where daily SQLite backups go. Defaults to a "backups" folder next to the database file. */
  backupDir: env.BACKUP_DIR ?? path.join(path.dirname(path.resolve(env.DB_PATH ?? 'data/kopeika.db')), 'backups'),
  /** How many daily backups to keep. */
  backupKeep: parseNumber('BACKUP_KEEP', env.BACKUP_KEEP, { default: 14, max: 10000 }),
  /** Local server hour (0-23) when the daily chat digest is posted. */
  chatDigestHour: parseNumber('CHAT_DIGEST_HOUR', env.CHAT_DIGEST_HOUR, { default: 20, min: 0, max: 23 }),
  staticDir: env.STATIC_DIR ?? path.resolve('web/dist'),
  /** Run the bot with long polling. Disable locally if the production bot uses the same token. */
  botPolling: (env.BOT_POLLING ?? '1') === '1',
  /** Accept "Authorization: dev <userId>" to test in a regular browser. Never enable in production. */
  devAuth: env.DEV_AUTH === '1',
  /** How long a Telegram initData signature stays valid. */
  initDataMaxAgeSec: parseNumber('INIT_DATA_MAX_AGE', env.INIT_DATA_MAX_AGE, {
    default: 24 * 60 * 60,
    max: 30 * 24 * 60 * 60,
  }),
  /** Telegram ids (comma-separated) that may use /stats in a private chat with the bot. Empty = nobody. */
  adminUserIds: parseAdminIds(env.ADMIN_USER_IDS),
  /** Max API requests per user per minute. */
  rateLimitPerMin: parseNumber('RATE_LIMIT_PER_MIN', env.RATE_LIMIT_PER_MIN, { default: 120, max: 1_000_000 }),
  ratesLimitPerMin: parseNumber('RATES_LIMIT_PER_MIN', env.RATES_LIMIT_PER_MIN, { default: 20, max: 1_000_000 }),
  /** Anthropic API key for receipt recognition. Empty = the feature is off. Never logged or returned to clients. */
  anthropicApiKey: env.ANTHROPIC_API_KEY ?? '',
  /** Optional gateway/proxy address for the Anthropic API; empty = the SDK default. */
  anthropicBaseUrl: env.ANTHROPIC_BASE_URL ?? '',
  /** Model that reads receipt photos. */
  receiptsModel: env.RECEIPTS_MODEL?.trim() || 'claude-haiku-5-5',
  /** Stronger model tried once when the sum of the lines does not match the total. Empty (default) = no cascade. */
  receiptsFallbackModel: env.RECEIPTS_FALLBACK_MODEL?.trim() ?? '',
  /** Timeout of one recognition request to the provider, seconds. */
  receiptsTimeoutSec: parseNumber('RECEIPTS_TIMEOUT_SEC', env.RECEIPTS_TIMEOUT_SEC, { default: 30, max: 300 }),
  /** Quotas, so one account cannot grow the database without bound. */
  maxGroupsPerUser: parseNumber('MAX_GROUPS_PER_USER', env.MAX_GROUPS_PER_USER, { default: 100, max: 1_000_000 }),
  maxMembersPerGroup: parseNumber('MAX_MEMBERS_PER_GROUP', env.MAX_MEMBERS_PER_GROUP, { default: 100, max: 1_000_000 }),
  maxExpensesPerGroup: parseNumber('MAX_EXPENSES_PER_GROUP', env.MAX_EXPENSES_PER_GROUP, {
    default: 10_000,
    max: 100_000_000,
  }),
  maxRecurringPerGroup: parseNumber('MAX_RECURRING_PER_GROUP', env.MAX_RECURRING_PER_GROUP, {
    default: 50,
    max: 1_000_000,
  }),
  /** How many of the latest expenses a group detail carries; older ones are fetched page by page. */
  expensesPage: parseNumber('EXPENSES_PAGE', env.EXPENSES_PAGE, { default: 200, max: 1000 }),
  /** Bot: commands and inline queries per user per minute. */
  botCommandsPerMin: parseNumber('BOT_COMMANDS_PER_MIN', env.BOT_COMMANDS_PER_MIN, { default: 20, max: 1_000_000 }),
  botInlinePerMin: parseNumber('BOT_INLINE_PER_MIN', env.BOT_INLINE_PER_MIN, { default: 30, max: 1_000_000 }),
};
