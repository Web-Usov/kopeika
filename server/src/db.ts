import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { config } from './config.ts';

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
