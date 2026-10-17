// Closed beta of receipt scanning (#125). With RECEIPTS_BETA on (default) a group can scan only after the owner
// approved it (`receipts_beta`, which keeps the monthly trial limit) or granted `receipts` (no limit, implies access).
import { config } from '../config.ts';
import { all, one, run, tx } from '../db.ts';
import { fail } from '../errors.ts';
import { countEvent } from '../stats.ts';
import { hasReceiptsEntitlement } from './limits.ts';

export type AccessState = 'none' | 'pending' | 'approved' | 'rejected';
export type RequestStatus = 'pending' | 'approved' | 'rejected';

/** After a rejection the same group may ask again once a day has passed. */
export const REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

interface RequestRow {
  id: number;
  group_id: number;
  requested_by: number;
  status: RequestStatus;
  created_at: string;
  decided_at: string | null;
  decided_by: number | null;
}

function hasBetaEntitlement(groupId: number, now: Date): boolean {
  const row = one<{ expires_at: string | null }>(
    "SELECT expires_at FROM group_entitlements WHERE group_id = ? AND feature = 'receipts_beta'",
    groupId,
  );
  return row !== undefined && (row.expires_at === null || row.expires_at > now.toISOString());
}

/** May the group scan at all (before the monthly limit)? Always true when the beta is off. */
export function hasReceiptsAccess(groupId: number, now = new Date()): boolean {
  return !config.receiptsBeta || hasReceiptsEntitlement(groupId, now) || hasBetaEntitlement(groupId, now);
}

const lastRequest = (groupId: number) =>
  one<RequestRow>('SELECT * FROM receipt_access_requests WHERE group_id = ? ORDER BY id DESC LIMIT 1', groupId);

/** What the client shows: approved wins; otherwise the state of the group's latest request. */
export function accessState(groupId: number, now = new Date()): AccessState {
  if (hasReceiptsAccess(groupId, now)) return 'approved';
  const last = lastRequest(groupId);
  // An approved request whose right was revoked later counts as no request.
  return last && last.status !== 'approved' ? last.status : 'none';
}

/**
 * A member asks for access. Idempotent while a request is pending; a rejected group waits a day.
 * `created` is true only when a new request was stored (then the owner has to be told).
 */
export function requestAccess(
  groupId: number,
  userId: number,
  now = new Date(),
): { created: boolean; requestId: number | null } {
  return tx(() => {
    if (hasReceiptsAccess(groupId, now)) return { created: false, requestId: null };
    const last = lastRequest(groupId);
    if (last?.status === 'pending') return { created: false, requestId: last.id };
    if (
      last?.status === 'rejected' &&
      last.decided_at &&
      now.getTime() - Date.parse(last.decided_at) < REQUEST_COOLDOWN_MS
    ) {
      throw fail(429, 'errors.receipt.accessCooldown');
    }
    const res = run(
      "INSERT INTO receipt_access_requests (group_id, requested_by, status, created_at) VALUES (?, ?, 'pending', ?)",
      groupId,
      userId,
      now.toISOString(),
    );
    countEvent('receipt.access', now);
    return { created: true, requestId: Number(res.lastInsertRowid) };
  });
}

export interface AccessRequestInfo {
  id: number;
  status: RequestStatus;
  groupId: number;
  groupName: string;
  inviteCode: string;
  requestedBy: number;
  requesterName: string;
  members: number;
  expenses: number;
  createdAt: string;
}

export function accessRequestInfo(id: number): AccessRequestInfo | null {
  const r = one<{
    id: number;
    status: RequestStatus;
    group_id: number;
    name: string;
    invite_code: string;
    requested_by: number;
    first_name: string | null;
    created_at: string;
    members: number;
    expenses: number;
  }>(
    `SELECT r.id, r.status, r.group_id, g.name, g.invite_code, r.requested_by, u.first_name, r.created_at,
            (SELECT COUNT(*) FROM members m WHERE m.group_id = g.id) AS members,
            (SELECT COUNT(*) FROM expenses e WHERE e.group_id = g.id) AS expenses
     FROM receipt_access_requests r
     JOIN groups g ON g.id = r.group_id
     LEFT JOIN users u ON u.id = r.requested_by
     WHERE r.id = ?`,
    id,
  );
  if (!r) return null;
  return {
    id: r.id,
    status: r.status,
    groupId: r.group_id,
    groupName: r.name,
    inviteCode: r.invite_code,
    requestedBy: r.requested_by,
    requesterName: r.first_name ?? '',
    members: r.members,
    expenses: r.expenses,
    createdAt: r.created_at,
  };
}

function openBeta(groupId: number, adminId: number, now: Date) {
  run(
    `INSERT OR REPLACE INTO group_entitlements (group_id, feature, source, granted_at, expires_at, granted_by)
     VALUES (?, 'receipts_beta', 'admin', ?, NULL, ?)`,
    groupId,
    now.toISOString(),
    adminId,
  );
}

export type Decision =
  | { ok: true; info: AccessRequestInfo }
  | { ok: false; reason: 'notFound' | 'already'; status?: RequestStatus };

/**
 * The owner's decision on a request. Nothing changes when it was decided before.
 * Approval gives the group `receipts_beta`; rejection only records the decision.
 */
export function decideRequest(requestId: number, approve: boolean, adminId: number, now = new Date()): Decision {
  return tx((): Decision => {
    const info = accessRequestInfo(requestId);
    if (!info) return { ok: false, reason: 'notFound' };
    if (info.status !== 'pending') return { ok: false, reason: 'already', status: info.status };
    const status: RequestStatus = approve ? 'approved' : 'rejected';
    run(
      'UPDATE receipt_access_requests SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?',
      status,
      now.toISOString(),
      adminId,
      requestId,
    );
    if (approve) openBeta(info.groupId, adminId, now);
    return { ok: true, info: { ...info, status } };
  });
}

/** Owner command /beta: open access without a request (a pending request of the group is closed as approved). */
export function grantBeta(inviteCode: string, adminId: number, now = new Date()) {
  const group = one<{ id: number; name: string }>(
    'SELECT id, name FROM groups WHERE invite_code = ? AND is_demo = 0',
    inviteCode,
  );
  if (!group) return null;
  tx(() => {
    openBeta(group.id, adminId, now);
    run(
      "UPDATE receipt_access_requests SET status = 'approved', decided_at = ?, decided_by = ? WHERE group_id = ? AND status = 'pending'",
      now.toISOString(),
      adminId,
      group.id,
    );
  });
  return group;
}

/** Owner command /requests: pending requests, oldest first. */
export function pendingRequests(): AccessRequestInfo[] {
  return all<{ id: number }>("SELECT id FROM receipt_access_requests WHERE status = 'pending' ORDER BY id")
    .map((r) => accessRequestInfo(r.id))
    .filter((r): r is AccessRequestInfo => r !== null);
}
