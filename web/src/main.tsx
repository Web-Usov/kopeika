import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { initTelegram, startParam } from './tg.tsx';
import './styles.css';

initTelegram();

// Opened through an invite link (t.me/<bot>/<app>?startapp=CODE): go straight to the join screen.
const code = startParam();
if (code && /^[\w-]+$/.test(code)) history.replaceState(null, '', `#/join/${code}`);

createRoot(document.getElementById('root')!).render(<App />);
