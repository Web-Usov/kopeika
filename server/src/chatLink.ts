import crypto from 'node:crypto';
import { createT, type Lang } from '../../shared/i18n/index.ts';
import { logActivity } from './activity.ts';
import { one, run, tx } from './db.ts';
import type { GroupRow } from './repo.ts';

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

/** Creates a one-time token for a chat the bot was just added to. */
export function createChatLink(chatId: number, chatTitle: string, userId: number, now = new Date()): string {
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
    run('UPDATE groups SET chat_id = ?, chat_title = ? WHERE id = ?', link.chat_id, link.chat_title, group.id);
    run("UPDATE chat_links SET used_at = datetime('now') WHERE token = ?", link.token);
    logActivity(group.id, userId, 'group.chat_link', { name: link.chat_title });
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

/** Confirmation in the chat after linking, with a "join" button when the invite link exists. */
export function linkedMessage(lang: Lang, groupName: string, inviteUrl: string | null): ChatMessage {
  const t = createT(lang);
  const text = t('bot.chatLinked', { name: groupName });
  return inviteUrl ? { text, button: { text: t('bot.chatJoinButton'), url: inviteUrl } } : { text };
}
