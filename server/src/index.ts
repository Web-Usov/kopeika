import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { startBackupSchedule } from './backup.ts';
import { startBot } from './bot.ts';
import { config } from './config.ts';

const app = createApp(config.staticDir);

if (config.devAuth) console.warn('DEV_AUTH=1: accepting fake users. Never enable this in production!');

await startBot().catch((e) => console.error('Bot failed to start', e));

startBackupSchedule();

serve({ fetch: app.fetch, port: config.port }, (info) => console.log(`Kopeika listening on :${info.port}`));
