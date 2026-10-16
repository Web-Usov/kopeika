// Minimal hash router. Screens declare their parent, so Telegram's back arrow always goes "up",
// no matter how the app was opened (e.g. straight into a group from a notification).
import { useSyncExternalStore } from 'react';

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};
// Anything that isn't a route (e.g. Telegram's "#tgWebAppData=..." launch params) means the home screen.
const getHash = () => (location.hash.startsWith('#/') ? location.hash.slice(1) : '/');

export function useLocation() {
  const hash = useSyncExternalStore(subscribe, getHash);
  const [path, query = ''] = hash.split('?');
  return { path, query: new URLSearchParams(query) };
}

export function navigate(to: string, { replace = false } = {}) {
  if (replace) {
    history.replaceState(null, '', `#${to}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = to;
  }
  window.scrollTo(0, 0);
}

/** Matches "/g/:id/expense/:eid" style patterns. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/');
  const s = path.split('/');
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}
