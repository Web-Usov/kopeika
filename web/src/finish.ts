import { api, type GroupDetail, setGroup } from './api.ts';
import { navigate } from './router.ts';
import { alertDialog, haptic } from './tg.tsx';

/** Everyone is even and something was spent: the moment to offer to finish the trip. */
export const isAllSettled = (g: GroupDetail) => g.totalSpent > 0 && g.members.every((m) => m.balance === 0);

/** The newest ledger entry; «Not now» is remembered against it, so the next expense brings the offer back. */
const latestEntryId = (g: GroupDetail) => g.expenses.reduce((max, e) => Math.max(max, e.id), 0);

const key = (g: GroupDetail) => `finishDismissed:${g.id}`;

export function finishOfferDismissed(g: GroupDetail): boolean {
  try {
    return localStorage.getItem(key(g)) === String(latestEntryId(g));
  } catch {
    return false;
  }
}

export function dismissFinishOffer(g: GroupDetail) {
  try {
    localStorage.setItem(key(g), String(latestEntryId(g)));
  } catch {
    // storage is a convenience only
  }
}

/** Archives the group (the server posts the summary card to the linked chat) and opens the summary. */
export async function finishTrip(g: GroupDetail): Promise<boolean> {
  try {
    setGroup(await api.archiveGroup(g.id));
    haptic.success();
    navigate(`/g/${g.id}/summary`, { replace: true });
    return true;
  } catch (e) {
    haptic.error();
    await alertDialog((e as Error).message);
    return false;
  }
}
