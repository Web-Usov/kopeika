import { api } from './api.ts';
import { inTelegram, requestWriteAccess, tg } from './tg.tsx';

const ASKED_KEY = 'kopeika:notify-asked';

/**
 * Asks once (after the user creates or joins a group) whether the bot may message them.
 * Telegram shows its own native permission dialog.
 */
export async function askNotifyOnce() {
  if (!inTelegram || tg!.initDataUnsafe.user?.allows_write_to_pm) return;
  try {
    if (localStorage.getItem(ASKED_KEY)) return;
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    // storage unavailable: just ask
  }
  if (await requestWriteAccess()) await api.setNotify(true).catch(() => {});
}
