import fs from 'node:fs';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { api } from './api.ts';
import { config } from './config.ts';
import { privacyLang, renderPrivacyHtml, renderTermsHtml } from './privacy.ts';
import { sha, version } from './version.ts';

/** The whole HTTP app: API plus (if the folder exists) the built Mini App from `staticDir`. */
/** Content-Security-Policy for HTML pages. telegram.org serves telegram-web-app.js; avatars come from Telegram over https. */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://telegram.org",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "connect-src 'self'",
  'frame-ancestors https://web.telegram.org https://*.telegram.org',
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

export function createApp(staticDir: string) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    if (c.res.headers.get('Content-Type')?.startsWith('text/html')) c.header('Content-Security-Policy', CSP);
  });

  app.get('/healthz', (c) => c.text('ok'));
  app.get('/version', (c) => c.json({ version, sha }));
  // Public privacy policy (for @BotFather): outside /api, no auth.
  app.get('/privacy', (c) => {
    const lang = privacyLang(c.req.query('lang'), c.req.header('accept-language'));
    c.header('Cache-Control', 'no-cache');
    return c.html(renderPrivacyHtml(lang, config.receiptsProvider));
  });
  // Public Terms of Service: same idea.
  app.get('/terms', (c) => {
    const lang = privacyLang(c.req.query('lang'), c.req.header('accept-language'));
    c.header('Cache-Control', 'no-cache');
    return c.html(renderTermsHtml(lang));
  });
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
