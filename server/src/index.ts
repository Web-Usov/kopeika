import { serve } from '@hono/node-server';
import { installProcessHandlers } from './alerts.ts';
import { createApp } from './app.ts';
import { startAutoRemindSchedule } from './autoremind.ts';
import { startBackupSchedule } from './backup.ts';
import { startBot } from './bot.ts';
import { config } from './config.ts';
import { startDigestSchedule } from './digest.ts';
import { startRecurringSchedule } from './recurring.ts';
import { startStatsWeeklySchedule } from './statsWeekly.ts';
import { version } from './version.ts';

installProcessHandlers();

const app = createApp(config.staticDir);

if (config.devAuth) console.warn('DEV_AUTH=1: accepting fake users. Never enable this in production!');

// The HTTP server comes first: /healthz and the API must work even if Telegram is unreachable.
serve({ fetch: app.fetch, port: config.port }, (info) => console.log(`Kopeika ${version} listening on :${info.port}`));

// The bot connects in the background and retries on its own.
startBot();

startBackupSchedule();
startDigestSchedule();
startAutoRemindSchedule();

startRecurringSchedule();
startStatsWeeklySchedule();
