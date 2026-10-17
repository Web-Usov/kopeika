import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { config } from './config.ts';

// `node --test` children have NODE_TEST_CONTEXT; a test without its own DB_PATH would write to data/kopeika.db.
if (process.env.NODE_TEST_CONTEXT && !process.env.DB_PATH) {
  throw new Error(
    "В тестах задайте DB_PATH (например ':memory:') до импорта db.ts: импортируйте './test-env.ts' первым.",
  );
}

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

// Append-only list: each entry upgrades the schema by one version.
const migrations = [
  `
  CREATE TABLE users (
    id          INTEGER PRIMARY KEY,           -- Telegram user id
    first_name  TEXT NOT NULL,
    last_name   TEXT,
    username    TEXT,
    photo_url   TEXT,
    notify      INTEGER NOT NULL DEFAULT 0,    -- bot may send notifications
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE groups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    currency    TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    created_by  INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE members (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id     INTEGER REFERENCES users(id),  -- NULL for people without Telegram
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (group_id, user_id)
  );
  CREATE INDEX members_user ON members(user_id);
  CREATE TABLE expenses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('expense', 'transfer')),
    title       TEXT NOT NULL,
    amount      INTEGER NOT NULL CHECK (amount > 0),   -- minor units
    payer_id    INTEGER NOT NULL REFERENCES members(id),
    split_mode  TEXT NOT NULL CHECK (split_mode IN ('equal', 'shares', 'exact')),
    spent_on    TEXT NOT NULL,                          -- YYYY-MM-DD
    created_by  INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX expenses_group ON expenses(group_id, spent_on);
  CREATE TABLE expense_shares (
    expense_id  INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    member_id   INTEGER NOT NULL REFERENCES members(id),
    input       INTEGER NOT NULL,   -- what the user entered: 1 / weight / exact amount
    amount      INTEGER NOT NULL,   -- computed share in minor units
    PRIMARY KEY (expense_id, member_id)
  );
  CREATE INDEX expense_shares_member ON expense_shares(member_id);
  `,
  // Interface language of the user ('ru' | 'en'), for bot messages.
  `ALTER TABLE users ADD COLUMN lang TEXT;`,
  // Payment details (JSON: phone, bank, card, link, note) to show to debtors: personal ones in users,
  // for people without Telegram in members. The app never moves money, it only shows these.
  `ALTER TABLE users ADD COLUMN payment_info TEXT; ALTER TABLE members ADD COLUMN payment_info TEXT;`,
  // Expense category id (see shared/categories.ts); transfers keep 'other' and never show it.
  `ALTER TABLE expenses ADD COLUMN category TEXT NOT NULL DEFAULT 'other';`,
  // Group change log ("History" tab): written in the same transaction as the change itself.
  // payload is JSON with snapshots (titles, amounts, names at that moment) so the text can be rendered later.
  `
  CREATE TABLE activity (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id),   -- who did it
    action      TEXT NOT NULL,
    payload     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX activity_group ON activity(group_id, id);
  `,
  // Archived groups are hidden from the home screen (a new expense brings the group back).
  `ALTER TABLE groups ADD COLUMN archived_at TEXT;`,
  // Debt reminders ("Remind" button): at most one per (group, from, to) per 24 hours. created_at is UTC.
  `
  CREATE TABLE reminders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    from_member INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,  -- creditor who reminds
    to_member   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,  -- debtor who is reminded
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX reminders_pair ON reminders(group_id, from_member, to_member, created_at);
  `,
  // Foreign-currency expenses: amount and shares stay in the group currency; the original amount, its currency and
  // the rate (decimal string, group-currency units per 1 original unit) are kept for display and editing.
  // rates caches daily rates from the source: rub_per_unit is a decimal string, date is the requested day,
  // source_date the day the source actually had a rate for (weekends and holidays fall back to earlier days).
  `
  ALTER TABLE expenses ADD COLUMN original_amount INTEGER;
  ALTER TABLE expenses ADD COLUMN original_currency TEXT;
  ALTER TABLE expenses ADD COLUMN rate TEXT;
  CREATE TABLE rates (
    date         TEXT NOT NULL,
    currency     TEXT NOT NULL,
    rub_per_unit TEXT NOT NULL,
    source_date  TEXT NOT NULL,
    PRIMARY KEY (date, currency)
  );
  `,
  // Linking a group chat to a group: one chat <-> one group. chat_links are one-time tokens (24 h) that the bot
  // hands out when it is added to a chat; the Mini App exchanges one for groups.chat_id / chat_title.
  `
  ALTER TABLE groups ADD COLUMN chat_id INTEGER;
  ALTER TABLE groups ADD COLUMN chat_title TEXT;
  CREATE UNIQUE INDEX groups_chat ON groups(chat_id) WHERE chat_id IS NOT NULL;
  CREATE TABLE chat_links (
    token           TEXT PRIMARY KEY,
    chat_id         INTEGER NOT NULL,
    chat_title      TEXT NOT NULL,
    created_by_user INTEGER NOT NULL,
    expires_at      TEXT NOT NULL,   -- UTC, 'YYYY-MM-DD HH:MM:SS'
    used_at         TEXT
  );
  CREATE INDEX chat_links_chat ON chat_links(chat_id);
  `,
  // Recurring expenses: a template that the scheduler turns into a regular expense on schedule.
  // shares is JSON [{memberId, value}] as in the expense form; day is the day of month (1-31) for "monthly"
  // and the ISO weekday (1-7) for "weekly"; next_date (YYYY-MM-DD) is the next occurrence not yet created.
  // Group currency only. The scheduler moves next_date forward in the same transaction that creates the expense.
  `
  CREATE TABLE recurring (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    created_by  INTEGER NOT NULL REFERENCES users(id),
    title       TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'other',
    amount      INTEGER NOT NULL CHECK (amount > 0),
    payer_id    INTEGER NOT NULL,
    split_mode  TEXT NOT NULL CHECK (split_mode IN ('equal', 'shares', 'exact')),
    shares      TEXT NOT NULL,
    period      TEXT NOT NULL CHECK (period IN ('monthly', 'weekly')),
    day         INTEGER NOT NULL,
    start_date  TEXT NOT NULL,
    next_date   TEXT NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX recurring_group ON recurring(group_id);
  CREATE INDEX recurring_due ON recurring(active, next_date);
  `,
  // What the bot posts to the linked chat: 'off' | 'each' (every expense) | 'daily' (digest). last_digest_date is the
  // server-local day of the last daily digest (one per day); last_digest_at (UTC) is the start of the next digest window.
  `
  ALTER TABLE groups ADD COLUMN chat_feed TEXT NOT NULL DEFAULT 'each';
  ALTER TABLE groups ADD COLUMN last_digest_date TEXT;
  ALTER TABLE groups ADD COLUMN last_digest_at TEXT;
  `,
  // Balances are aggregated in SQL (SUM paid per payer, SUM shares per member): covering indexes make those index-only.
  // expense_shares_member is a prefix of the new one, so it goes away. Totals per group: (group_id, kind, amount).
  `
  CREATE INDEX expenses_payer ON expenses(payer_id, amount);
  CREATE INDEX expenses_group_kind ON expenses(group_id, kind, amount);
  DROP INDEX expense_shares_member;
  CREATE INDEX expense_shares_member_amount ON expense_shares(member_id, amount);
  `,
  // Placeholder "deleted user" (id 0 never collides with a Telegram id). Account deletion points expenses.created_by,
  // activity.user_id and recurring.created_by of the removed user here, so history stays but is anonymous.
  `INSERT INTO users (id, first_name) VALUES (0, '');`,
  // Anonymous daily usage counters (server-local day). No user or group ids: only how often something happened.
  `
  CREATE TABLE stats_daily (
    date   TEXT NOT NULL,      -- YYYY-MM-DD
    event  TEXT NOT NULL,
    count  INTEGER NOT NULL,
    PRIMARY KEY (date, event)
  );
  `,
  // Demo group ("Look at an example" on first launch): a sandbox with made-up people and expenses. Invites, the bot,
  // chat links, recurring templates and the inline list ignore it; it is deleted like any other group.
  `ALTER TABLE groups ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;`,
  // Receipts (#102): rights of a group (a trial is the absence of a row; 'stars' is reserved for paid Premium),
  // a ledger of provider calls for cost control (no receipt content, no photo), the user's consent, and a marker
  // so that each monthly budget warning reaches the owner once.
  `
  ALTER TABLE users ADD COLUMN receipt_consent_at TEXT;
  CREATE TABLE group_entitlements (
    group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    feature     TEXT NOT NULL CHECK (feature IN ('receipts')),
    source      TEXT NOT NULL CHECK (source IN ('trial', 'admin', 'stars')),
    granted_at  TEXT NOT NULL,   -- UTC ISO
    expires_at  TEXT,            -- UTC ISO; NULL = no end
    granted_by  INTEGER,
    PRIMARY KEY (group_id, feature)
  );
  CREATE TABLE receipt_scans (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,   -- 0 (the "deleted user") after account deletion; no foreign key on purpose
    group_id        INTEGER NOT NULL,   -- no foreign key: the spend stays in the budget after the group is gone
    created_at      TEXT NOT NULL,      -- UTC ISO
    model           TEXT NOT NULL,
    input_tokens    INTEGER NOT NULL,
    output_tokens   INTEGER NOT NULL,
    cost_micro_usd  INTEGER NOT NULL,
    counted         INTEGER NOT NULL DEFAULT 0   -- 1: a successful scan that counts against the group's free quota
  );
  CREATE INDEX receipt_scans_group ON receipt_scans(group_id, created_at);
  CREATE INDEX receipt_scans_time ON receipt_scans(created_at);
  CREATE TABLE receipt_notices (
    month  TEXT NOT NULL,   -- YYYY-MM, server-local
    kind   TEXT NOT NULL,   -- 'warn' | 'stop'
    PRIMARY KEY (month, kind)
  );
  `,
  // Chat requests: the Mini App asks Telegram to let the user pick a chat (WebApp.requestChat); the bot gets the
  // choice as chat_shared with this row's id as request_id and links the chat to group_id. Short-lived, one use.
  `
  CREATE TABLE chat_requests (
    id         INTEGER PRIMARY KEY,   -- random, fits Telegram's signed 32-bit request_id
    user_id    INTEGER NOT NULL,
    group_id   INTEGER NOT NULL,
    expires_at TEXT NOT NULL,         -- UTC, 'YYYY-MM-DD HH:MM:SS'
    used_at    TEXT
  );
  `,
  // Closed beta of receipt scanning (#125): the owner opens it per group. A new right `receipts_beta` (the CHECK of
  // group_entitlements has to be widened, so the table is rebuilt) and the access requests with the owner's decision.
  `
  CREATE TABLE group_entitlements_new (
    group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    feature     TEXT NOT NULL CHECK (feature IN ('receipts', 'receipts_beta')),
    source      TEXT NOT NULL CHECK (source IN ('trial', 'admin', 'stars')),
    granted_at  TEXT NOT NULL,   -- UTC ISO
    expires_at  TEXT,            -- UTC ISO; NULL = no end
    granted_by  INTEGER,
    PRIMARY KEY (group_id, feature)
  );
  INSERT INTO group_entitlements_new SELECT * FROM group_entitlements;
  DROP TABLE group_entitlements;
  ALTER TABLE group_entitlements_new RENAME TO group_entitlements;
  CREATE TABLE receipt_access_requests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id     INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    requested_by INTEGER NOT NULL,   -- 0 (the "deleted user") after account deletion; no foreign key on purpose
    status       TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at   TEXT NOT NULL,      -- UTC ISO
    decided_at   TEXT,               -- UTC ISO
    decided_by   INTEGER
  );
  CREATE INDEX receipt_access_requests_group ON receipt_access_requests(group_id, id);
  `,
  // Receipt consent names the provider it was given for: after RECEIPTS_PROVIDER changes, people agree again.
  // Every consent before this migration was for Anthropic, the only provider until OpenRouter (#127).
  `
  ALTER TABLE users ADD COLUMN receipt_consent_provider TEXT;
  UPDATE users SET receipt_consent_provider = 'anthropic' WHERE receipt_consent_at IS NOT NULL;
  `,
  // Automatic debt reminders (#135): a group setting (off by default), and a mark on reminders that tells the bot's
  // own (auto = 1) from the ones a creditor pressed. Both kinds share the 7-day cooldown per debtor.
  `
  ALTER TABLE groups ADD COLUMN auto_remind INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE reminders ADD COLUMN auto INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX reminders_debtor ON reminders(group_id, to_member, created_at);
  `,
];

const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
for (let v = current; v < migrations.length; v++) {
  tx(() => {
    db.exec(migrations[v]);
    db.exec(`PRAGMA user_version = ${v + 1}`);
  });
}

export function one<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function run(sql: string, ...params: SQLInputValue[]) {
  return db.prepare(sql).run(...params);
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
