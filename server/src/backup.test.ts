import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

// config.ts and db.ts read env at import time, so set it before the dynamic import.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kopeika-backup-'));
const backupDir = path.join(tmp, 'backups');
process.env.DB_PATH = path.join(tmp, 'kopeika.db');
process.env.BACKUP_DIR = backupDir;
process.env.BACKUP_KEEP = '3';
delete process.env.BOT_TOKEN;

test('creates a readable backup, is idempotent within a day, rotates old files', async () => {
  const { runBackup } = await import('./backup.ts');
  const { db } = await import('./db.ts');
  db.exec('CREATE TABLE IF NOT EXISTS backup_probe (x)');
  db.exec('INSERT INTO backup_probe VALUES (1)');

  fs.mkdirSync(backupDir, { recursive: true });
  for (const d of ['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-04']) {
    fs.writeFileSync(path.join(backupDir, `kopeika-${d}.db`), 'old');
  }
  fs.writeFileSync(path.join(backupDir, 'notes.txt'), 'keep me');
  fs.writeFileSync(path.join(backupDir, 'kopeika-latest.db'), 'keep me too');

  const file = runBackup(new Date(2024, 5, 15, 12, 0, 0));
  assert.equal(file, path.join(backupDir, 'kopeika-2024-06-15.db'));
  assert.ok(file && fs.existsSync(file));

  const copy = new DatabaseSync(file, { readOnly: true });
  assert.equal((copy.prepare('SELECT count(*) AS n FROM backup_probe').get() as { n: number }).n, 1);
  copy.close();

  // Same day: skipped.
  assert.equal(runBackup(new Date(2024, 5, 15, 23, 0, 0)), null);

  // Only the 3 newest dated backups remain; unrelated files are untouched.
  assert.deepEqual(fs.readdirSync(backupDir).sort(), [
    'kopeika-2020-01-03.db',
    'kopeika-2020-01-04.db',
    'kopeika-2024-06-15.db',
    'kopeika-latest.db',
    'notes.txt',
  ]);
});
