import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { config } from './config.ts';
import { api } from './api.ts';
import { startBot } from './bot.ts';

const app = new Hono();

app.get('/healthz', (c) => c.text('ok'));
app.route('/api', api);

if (fs.existsSync(config.staticDir)) {
  const root = path.relative(process.cwd(), config.staticDir);
  app.use('/assets/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
  });
  app.use('*', serveStatic({ root }));
  // Single-page app: anything else gets index.html, never cached so new deploys show up immediately.
  app.get('*', serveStatic({ root, path: 'index.html', onFound: (_p, c) => void c.header('Cache-Control', 'no-cache') }));
}

if (config.devAuth) console.warn('DEV_AUTH=1: accepting fake users. Never enable this in production!');

await startBot().catch((e) => console.error('Bot failed to start', e));

serve({ fetch: app.fetch, port: config.port }, (info) => console.log(`Kopeika listening on :${info.port}`));
