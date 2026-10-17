import { DELETED_USER_ID, logActivity } from './activity.ts';
import { all, one, run, tx } from './db.ts';
import { fail } from './errors.ts';
import type { GroupRow, MemberRow } from './repo.ts';
import { countEvent } from './stats.ts';

/** Removes a group with everything in it (expenses, shares, members; history, reminders and templates cascade). */
export function eraseGroup(groupId: number) {
  run('DELETE FROM group_entitlements WHERE group_id = ?', groupId);
  run('DELETE FROM expense_shares WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = ?)', groupId);
  run('DELETE FROM expenses WHERE group_id = ?', groupId);
  run('DELETE FROM members WHERE group_id = ?', groupId);
  run('DELETE FROM groups WHERE id = ?', groupId);
}

/** The first member with Telegram other than `userId`, in join order. */
function heirOf(groupId: number, userId: number) {
  return one<{ user_id: number }>(
    'SELECT user_id FROM members WHERE group_id = ? AND user_id IS NOT NULL AND user_id != ? ORDER BY id LIMIT 1',
    groupId,
    userId,
  );
}

/**
 * Leaving keeps the person in the group as a name-only member, so history and balances stay intact.
 * The owner passes the group to the next member with Telegram. Call inside a transaction.
 */
export function leaveGroup(group: GroupRow, me: MemberRow, userId: number) {
  if (group.created_by === userId) {
    const heir = heirOf(group.id, userId);
    // The last person with Telegram can only delete the group: otherwise nobody could ever manage it.
    if (!heir) throw fail(409, 'errors.lastMemberLeave');
    run('UPDATE groups SET created_by = ? WHERE id = ?', heir.user_id, group.id);
  }
  logActivity(group.id, userId, 'member.leave', { memberId: me.id, name: me.name });
  run('UPDATE members SET user_id = NULL WHERE id = ?', me.id);
}

/**
 * Deletes everything that identifies the user, in one transaction:
 * - groups where nobody else has Telegram are deleted whole;
 * - in the other groups the user leaves (name-only member, ownership passed on), history stays for the others;
 * - their reminders, chat-link tokens and recurring templates are removed or stopped;
 * - expenses, history entries and templates they authored point at the "deleted user" placeholder;
 * - the users row (name, username, photo, language, payment details, notification flag) is deleted.
 * A later request from the same Telegram user simply creates a new account.
 */
export function deleteAccount(userId: number) {
  return tx(() => {
    let groupsDeleted = 0;
    let groupsLeft = 0;
    const memberships = all<{ group_id: number }>('SELECT group_id FROM members WHERE user_id = ?', userId);
    for (const { group_id } of memberships) {
      const group = one<GroupRow>('SELECT * FROM groups WHERE id = ?', group_id)!;
      const me = one<MemberRow>('SELECT * FROM members WHERE group_id = ? AND user_id = ?', group_id, userId)!;
      if (heirOf(group_id, userId)) {
        // Reminders involving this person are about a debt to or from someone who is no longer reachable.
        run('DELETE FROM reminders WHERE from_member = ? OR to_member = ?', me.id, me.id);
        leaveGroup(group, me, userId);
        groupsLeft++;
      } else {
        eraseGroup(group_id);
        groupsDeleted++;
      }
    }
    // The scan ledger is only numbers, but it still points at a person: detach it. The spend stays in the budget.
    run('UPDATE receipt_scans SET user_id = ? WHERE user_id = ?', DELETED_USER_ID, userId);
    run('UPDATE receipt_access_requests SET requested_by = ? WHERE requested_by = ?', DELETED_USER_ID, userId);
    run('DELETE FROM chat_links WHERE created_by_user = ?', userId);
    // A template would keep creating expenses on behalf of a person who is gone: stop it, the group can resume it.
    run('UPDATE recurring SET active = 0, created_by = ? WHERE created_by = ?', DELETED_USER_ID, userId);
    run('UPDATE expenses SET created_by = ? WHERE created_by = ?', DELETED_USER_ID, userId);
    run('UPDATE activity SET user_id = ? WHERE user_id = ?', DELETED_USER_ID, userId);
    run('DELETE FROM users WHERE id = ?', userId);
    countEvent('user.delete');
    return { ok: true, groupsDeleted, groupsLeft };
  });
}
