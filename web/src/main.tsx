import { createRoot } from 'react-dom/client';
import { parseStartParam } from '../../shared/invite.ts';
import { App } from './App.tsx';
import './i18n.ts';
import { joinSource } from './joinSource.ts';
import { initTelegram, startParam } from './tg.tsx';
import './styles.css';

initTelegram();

// Telegram passes launch params in the URL hash (#tgWebAppData=...). telegram-web-app.js has already
// read and saved them by now, so the hash can be handed over to our router.
// Opened through an invite link (t.me/<bot>/<app>?startapp=CODE): go straight to the join screen.
// `link_<token>` comes from the button the bot posts when it is added to a group chat: link that chat to a group.
const code = startParam();
if (code?.startsWith('link_') && /^[\w-]+$/.test(code)) history.replaceState(null, '', `#/link/${code.slice(5)}`);
else if (code && /^[\w-]+$/.test(code)) {
  // Cards posted to a chat carry a suffix on the code: strip it, keep the source for the join request.
  const { code: invite, source } = parseStartParam(code);
  joinSource.value = source;
  history.replaceState(null, '', `#/join/${invite}`);
} else if (!location.hash.startsWith('#/')) history.replaceState(null, '', '#/');

createRoot(document.getElementById('root')!).render(<App />);
