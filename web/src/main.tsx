import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { installErrorReporting } from './errorReport.ts';
import './i18n.ts';
import { initTelegram, startParam } from './tg.tsx';
import './styles.css';

initTelegram();

// Telegram passes launch params in the URL hash (#tgWebAppData=...). telegram-web-app.js has already
// read and saved them by now, so the hash can be handed over to our router.
// Opened through an invite link (t.me/<bot>/<app>?startapp=CODE): go straight to the join screen.
// `link_<token>` comes from the button the bot posts when it is added to a group chat: link that chat to a group.
const code = startParam();
if (code?.startsWith('link_') && /^[\w-]+$/.test(code)) history.replaceState(null, '', `#/link/${code.slice(5)}`);
else if (code && /^[\w-]+$/.test(code)) history.replaceState(null, '', `#/join/${code}`);
else if (!location.hash.startsWith('#/')) history.replaceState(null, '', '#/');

installErrorReporting();

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
