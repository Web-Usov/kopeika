import crypto from 'node:crypto';
import { createT, type Lang } from '../../shared/i18n/index.ts';
import { logActivity } from './activity.ts';
import { one, run, tx } from './db.ts';
import type { GroupRow } from './repo.ts';
import { countEvent } from './stats.ts';

const TOKEN_TTL_HOURS = 24;

export interface ChatLinkRow {
  token: string;
  chat_id: number;
  chat_title: string;
  created_by_user: number;
  expires_at: string;
  used_at: string | null;
}

/** Why a token can't be used; the API maps these to error messages. */
export type ChatLinkProblem = 'invalid' | 'expired' | 'used';

/** 24 random characters from the start_param alphabet (A-Za-z0-9_-). */
export function newChatToken(): string {
  return crypto.randomBytes(18).toString('base64url');
}

const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

const KEEP_DAYS = 7;

/** Deletes used and expired tokens older than a week. Idempotent; returns the number of removed rows. */
export function cleanupChatLinks(now = new Date()): number {
  const cutoff = sqlTime(new Date(now.getTime() - KEEP_DAYS * 24 * 3600_000));
  const res = run(
    'DELETE FROM chat_links WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?)',
    cutoff,
    cutoff,
  );
  return Number(res.changes);
}

/**
 * A one-time token for a chat the bot was just added to (or asked for /balance in). Returns the chat's existing valid
 * unused token if there is one, so repeated calls do not grow the table. Stale rows are cleaned up on the way.
 */
export function createChatLink(chatId: number, chatTitle: string, userId: number, now = new Date()): string {
  cleanupChatLinks(now);
  const existing = one<{ token: string }>(
    'SELECT token FROM chat_links WHERE chat_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY expires_at DESC LIMIT 1',
    chatId,
    sqlTime(now),
  );
  if (existing) return existing.token;
  const token = newChatToken();
  run(
    'INSERT INTO chat_links (token, chat_id, chat_title, created_by_user, expires_at) VALUES (?, ?, ?, ?, ?)',
    token,
    chatId,
    chatTitle,
    userId,
    sqlTime(new Date(now.getTime() + TOKEN_TTL_HOURS * 3600_000)),
  );
  return token;
}

export function checkChatLink(
  token: string,
  now = new Date(),
): { link: ChatLinkRow; problem?: undefined } | { link?: undefined; problem: ChatLinkProblem } {
  const link = one<ChatLinkRow>('SELECT * FROM chat_links WHERE token = ?', token);
  if (!link) return { problem: 'invalid' };
  if (link.used_at !== null) return { problem: 'used' };
  if (link.expires_at <= sqlTime(now)) return { problem: 'expired' };
  return { link };
}

/** The group a chat is currently linked to, if any. */
export function groupOfChat(chatId: number): GroupRow | undefined {
  return one<GroupRow>('SELECT * FROM groups WHERE chat_id = ?', chatId);
}

/**
 * Links the chat from a (valid) token to the group, in one transaction. The chat leaves any other group.
 * The caller has already checked that the user belongs to the group.
 */
export function attachChat(link: ChatLinkRow, group: GroupRow, userId: number) {
  tx(() => {
    const prev = groupOfChat(link.chat_id);
    if (prev && prev.id !== group.id) {
      run('UPDATE groups SET chat_id = NULL, chat_title = NULL WHERE id = ?', prev.id);
      logActivity(prev.id, userId, 'group.chat_unlink', { name: link.chat_title });
    }
    if (group.chat_id !== null && group.chat_id !== link.chat_id) {
      logActivity(group.id, userId, 'group.chat_unlink', { name: group.chat_title ?? '' });
    }
    run(
      "UPDATE groups SET chat_id = ?, chat_title = ?, chat_feed = 'each' WHERE id = ?",
      link.chat_id,
      link.chat_title,
      group.id,
    );
    // Spare tokens of the same chat (several /balance calls) die with it: nobody can relink the chat later with them.
    run("UPDATE chat_links SET used_at = datetime('now') WHERE chat_id = ? AND used_at IS NULL", link.chat_id);
    logActivity(group.id, userId, 'group.chat_link', { name: link.chat_title });
    countEvent('chat.link');
  });
}

/** Unlinks the group from its chat. Returns the old chat id, or null if there was none. */
export function unlinkGroup(group: GroupRow, userId: number): number | null {
  if (group.chat_id === null) return null;
  tx(() => {
    run('UPDATE groups SET chat_id = NULL, chat_title = NULL WHERE id = ?', group.id);
    logActivity(group.id, userId, 'group.chat_unlink', { name: group.chat_title ?? '' });
  });
  return group.chat_id;
}

/** Unlinks whichever group the chat belongs to (bot removed, /unlink). Returns that group, if there was one. */
export function unlinkChat(chatId: number, userId: number): GroupRow | undefined {
  const group = groupOfChat(chatId);
  if (group) unlinkGroup(group, userId);
  return group;
}

/** The chat became a supergroup: keep the link, change the id. */
export function migrateChat(oldId: number, newId: number) {
  tx(() => {
    run('UPDATE groups SET chat_id = ? WHERE chat_id = ?', newId, oldId);
    run('UPDATE chat_links SET chat_id = ? WHERE chat_id = ?', newId, oldId);
  });
}

export interface ChatMessage {
  text: string;
  /** Url button under the message; omitted when the link can't be built. */
  button?: { text: string; url: string };
}

/** Greeting after the bot was added to a chat. `linkUrl` is null when the app link isn't configured. */
export function welcomeMessage(lang: Lang, linkUrl: string | null): ChatMessage {
  const t = createT(lang);
  if (!linkUrl) return { text: t('bot.chatWelcomeNoButton') };
  return { text: t('bot.chatWelcome'), button: { text: t('bot.chatLinkButton'), url: linkUrl } };
}

// --- Linking from the Mini App: WebApp.requestChat -> chat_shared ---

const REQUEST_TTL_MIN = 15;

/** A pending «pick a chat» request. Its id is the request_id of the keyboard button, so Telegram brings it back. */
export function createChatRequest(userId: number, groupId: number, now = new Date()): number {
  run('DELETE FROM chat_requests WHERE expires_at < ?', sqlTime(new Date(now.getTime() - KEEP_DAYS * 24 * 3600_000)));
  for (;;) {
    const id = crypto.randomInt(1, 2 ** 31);
    if (one('SELECT 1 FROM chat_requests WHERE id = ?', id)) continue;
    run(
      'INSERT INTO chat_requests (id, user_id, group_id, expires_at) VALUES (?, ?, ?, ?)',
      id,
      userId,
      groupId,
      sqlTime(new Date(now.getTime() + REQUEST_TTL_MIN * 60_000)),
    );
    return id;
  }
}

export type ChatSharedProblem = 'invalid' | 'expired' | 'used' | 'demo' | 'notAdmin' | 'botMissing' | 'unavailable';

export type ChatSharedResult = { ok: true; group: GroupRow } | { ok: false; problem: ChatSharedProblem };

/** Looks up a user's role in a chat ('creator', 'administrator', 'left', ...); null when the bot isn't available. */
export type MemberLookup = (chatId: number, userId: number) => Promise<string | null>;

/**
 * The bot received chat_shared from `userId`: checks the request, that the user is an admin of the chosen chat and the
 * bot is in it, then links the chat to the group. Telegram itself is not called here: the lookup is injected.
 */
export async function handleChatShared(
  input: { userId: number; botId: number; requestId: number; chatId: number; title?: string },
  lookup: MemberLookup,
  now = new Date(),
): Promise<ChatSharedResult> {
  const req = one<{ user_id: number; group_id: number; expires_at: string; used_at: string | null }>(
    'SELECT * FROM chat_requests WHERE id = ?',
    input.requestId,
  );
  // A request of someone else is as good as unknown: do not reveal that it exists.
  if (!req || req.user_id !== input.userId) return { ok: false, problem: 'invalid' };
  if (req.used_at !== null) return { ok: false, problem: 'used' };
  if (req.expires_at <= sqlTime(now)) return { ok: false, problem: 'expired' };
  const group = one<GroupRow>('SELECT * FROM groups WHERE id = ?', req.group_id);
  const member = group && one('SELECT 1 FROM members WHERE group_id = ? AND user_id = ?', group.id, input.userId);
  if (!group || !member) return { ok: false, problem: 'invalid' };
  if (group.is_demo) return { ok: false, problem: 'demo' };
  let userStatus: string | null;
  let botStatus: string | null = null;
  try {
    userStatus = await lookup(input.chatId, input.userId);
    if (userStatus !== null) botStatus = await lookup(input.chatId, input.botId);
  } catch {
    return { ok: false, problem: 'unavailable' };
  }
  if (userStatus === null) return { ok: false, problem: 'unavailable' };
  if (userStatus !== 'creator' && userStatus !== 'administrator') return { ok: false, problem: 'notAdmin' };
  if (botStatus !== 'member' && botStatus !== 'administrator') return { ok: false, problem: 'botMissing' };
  run("UPDATE chat_requests SET used_at = datetime('now') WHERE id = ?", input.requestId);
  attachChat(
    {
      token: '',
      chat_id: input.chatId,
      chat_title: input.title?.trim() || String(input.chatId),
      created_by_user: input.userId,
      expires_at: req.expires_at,
      used_at: null,
    },
    group,
    input.userId,
  );
  return { ok: true, group: one<GroupRow>('SELECT * FROM groups WHERE id = ?', group.id)! };
}

/** Confirmation in the chat after linking, with a "join" button when the invite link exists. */
export function linkedMessage(lang: Lang, groupName: string, inviteUrl: string | null): ChatMessage {
  const t = createT(lang);
  const text = t('bot.chatLinked', { name: groupName });
  return inviteUrl ? { text, button: { text: t('bot.chatJoinButton'), url: inviteUrl } } : { text };
}
