import { config } from './config.ts';
import { one } from './db.ts';
import { fail } from './errors.ts';

const count = (sql: string, id: number) => one<{ n: number }>(sql, id)!.n;

/** Memberships the user has (created, joined or claimed), demo group included. */
export function assertCanJoinMoreGroups(userId: number) {
  if (count('SELECT COUNT(*) AS n FROM members WHERE user_id = ?', userId) >= config.maxGroupsPerUser)
    throw fail(409, 'errors.quota.groups', { max: config.maxGroupsPerUser });
}

/** `adding` people are about to join the group. */
export function assertRoomForMembers(groupId: number, adding = 1) {
  if (count('SELECT COUNT(*) AS n FROM members WHERE group_id = ?', groupId) + adding > config.maxMembersPerGroup)
    throw fail(409, 'errors.quota.members', { max: config.maxMembersPerGroup });
}

export function assertRoomForExpense(groupId: number) {
  if (count('SELECT COUNT(*) AS n FROM expenses WHERE group_id = ?', groupId) >= config.maxExpensesPerGroup)
    throw fail(409, 'errors.quota.expenses', { max: config.maxExpensesPerGroup });
}

export function assertRoomForRecurring(groupId: number) {
  if (count('SELECT COUNT(*) AS n FROM recurring WHERE group_id = ?', groupId) >= config.maxRecurringPerGroup)
    throw fail(409, 'errors.quota.recurring', { max: config.maxRecurringPerGroup });
}
