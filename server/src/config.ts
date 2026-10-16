import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  botToken: env.BOT_TOKEN ?? '',
  /** Public HTTPS URL of the Mini App, e.g. https://kopeika.usov-home.ru */
  appUrl: env.APP_URL ?? '',
  /** Short name given to the Mini App in @BotFather (/newapp); used for t.me/<bot>/<short> links. */
  appShortName: env.APP_SHORT_NAME ?? '',
  /** Timeout of every Telegram Bot API request, seconds. grammY's default is 500. */
  telegramTimeoutSec: Math.max(1, Number(env.TELEGRAM_TIMEOUT_SEC ?? 20) || 20),
  /** Custom Bot API address (proxy or self-hosted Bot API server); empty = https://api.telegram.org */
  telegramApiRoot: env.TELEGRAM_API_ROOT ?? '',
  dbPath: env.DB_PATH ?? path.resolve('data/kopeika.db'),
  /** Where daily SQLite backups go. Defaults to a "backups" folder next to the database file. */
  backupDir: env.BACKUP_DIR ?? path.join(path.dirname(path.resolve(env.DB_PATH ?? 'data/kopeika.db')), 'backups'),
  /** How many daily backups to keep. */
  backupKeep: Math.max(1, Math.floor(Number(env.BACKUP_KEEP ?? 14)) || 14),
  staticDir: env.STATIC_DIR ?? path.resolve('web/dist'),
  /** Run the bot with long polling. Disable locally if the production bot uses the same token. */
  botPolling: (env.BOT_POLLING ?? '1') === '1',
  /** Accept "Authorization: dev <userId>" to test in a regular browser. Never enable in production. */
  devAuth: env.DEV_AUTH === '1',
  /** How long a Telegram initData signature stays valid. */
  initDataMaxAgeSec: Number(env.INIT_DATA_MAX_AGE ?? 24 * 60 * 60),
  /** Max API requests per user per minute. */
  rateLimitPerMin: Number(env.RATE_LIMIT_PER_MIN ?? 120),
};
