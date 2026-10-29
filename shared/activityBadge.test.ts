import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIVITY_ACTIONS } from './activity.ts';
import { ACTIVITY_BADGES, activityBadge } from './activityBadge.ts';

test('every history action has a badge', () => {
  for (const action of ACTIVITY_ACTIONS) {
    const badge = ACTIVITY_BADGES[action];
    assert.ok(badge, action);
  }
  assert.equal(Object.keys(ACTIVITY_BADGES).length, ACTIVITY_ACTIONS.length);
});

test('transfers get the arrows badge, a deleted transfer keeps the trash', () => {
  const kind = { kind: 'transfer' };
  assert.equal(activityBadge({ action: 'expense.create', payload: { expense: kind } }).icon, 'transfer');
  assert.equal(activityBadge({ action: 'expense.update', payload: { after: kind } }).icon, 'transfer');
  assert.equal(activityBadge({ action: 'expense.delete', payload: { expense: kind } }).icon, 'trash');
  assert.equal(activityBadge({ action: 'expense.create', payload: { expense: { kind: 'expense' } } }).icon, 'plus');
});
