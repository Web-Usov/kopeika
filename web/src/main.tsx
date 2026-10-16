import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './i18n.ts';
import { initTelegram, startParam } from './tg.tsx';
import './styles.css';

initTelegram();

// Telegram passes launch params in the URL hash (#tgWebAppData=...). telegram-web-app.js has already
// read and saved them by now, so the hash can be handed over to our router.
// Opened through an invite link (t.me/<bot>/<app>?startapp=CODE): go straight to the join screen.
const code = startParam();
if (code && /^[\w-]+$/.test(code)) history.replaceState(null, '', `#/join/${code}`);
else if (!location.hash.startsWith('#/')) history.replaceState(null, '', '#/');

createRoot(document.getElementById('root')!).render(<App />);
