import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// config.ts and db.ts read env at import time, so set it before the dynamic import.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kopeika-static-'));
process.env.DB_PATH = ':memory:';
delete process.env.BOT_TOKEN;

fs.mkdirSync(path.join(tmp, 'assets'));
fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><title>Kopeika</title>');
fs.writeFileSync(path.join(tmp, 'assets', 'index-abc123.js'), 'console.log(1)');

test('index.html is never cached, hashed assets are immutable', async () => {
  const { createApp } = await import('./app.ts');
  const app = createApp(tmp);

  for (const url of ['/', '/index.html', '/groups/42']) {
    const res = await app.request(url);
    assert.equal(res.status, 200, url);
    assert.match(await res.text(), /<title>Kopeika/, url);
    assert.equal(res.headers.get('cache-control'), 'no-cache', url);
  }

  const asset = await app.request('/assets/index-abc123.js');
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
});

test('HTML pages carry a Content-Security-Policy', async () => {
  const { createApp, CSP } = await import('./app.ts');
  const app = createApp(tmp);
  for (const url of ['/', '/privacy', '/terms', '/groups/42']) {
    const res = await app.request(url);
    assert.equal(res.headers.get('content-security-policy'), CSP, url);
  }
  assert.match(CSP, /frame-ancestors https:\/\/web\.telegram\.org/);
  assert.equal((await app.request('/healthz')).headers.get('content-security-policy'), null);
});
