import fs from 'node:fs';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { api } from './api.ts';
import { sha, version } from './version.ts';

/** The whole HTTP app: API plus (if the folder exists) the built Mini App from `staticDir`. */
export function createApp(staticDir: string) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
  });

  app.get('/healthz', (c) => c.text('ok'));
  app.get('/version', (c) => c.json({ version, sha }));
  app.route('/api', api);

  if (fs.existsSync(staticDir)) {
    const root = path.relative(process.cwd(), staticDir);
    app.use('/assets/*', async (c, next) => {
      await next();
      c.header('Cache-Control', 'public, max-age=31536000, immutable');
    });
    // index.html is never cached (whether asked as /, /index.html or via the fallback below),
    // so a new deploy shows up immediately instead of an old copy kept by the Telegram client.
    // (Headers set inside serveStatic's onFound do not reach the response, hence the check after the fact.)
    app.use('*', async (c, next) => {
      await next();
      if (c.res.headers.get('Content-Type')?.startsWith('text/html')) c.header('Cache-Control', 'no-cache');
    });
    app.use('*', serveStatic({ root }));
    // Single-page app: anything else gets index.html.
    app.get('*', serveStatic({ root, path: 'index.html' }));
  }

  return app;
}
