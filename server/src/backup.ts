import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { db } from './db.ts';

const FILE_RE = /^kopeika-\d{4}-\d{2}-\d{2}\.db$/;
const CHECK_EVERY_MS = 60 * 60 * 1000;

function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Writes today's backup (if missing) and prunes old ones. Returns the new file path, or null if skipped. */
export function runBackup(now = new Date()): string | null {
  if (config.dbPath === ':memory:') return null;
  const dir = config.backupDir;
  const file = path.join(dir, `kopeika-${localDate(now)}.db`);
  if (fs.existsSync(file)) return null;
  if (file.includes("'")) throw new Error("Backup path must not contain a single quote (')");

  fs.mkdirSync(dir, { recursive: true });
  // Write to a temp name first so a half-written file is never taken for a finished backup.
  const tmp = `${file}.tmp`;
  fs.rmSync(tmp, { force: true });
  try {
    db.exec(`VACUUM INTO '${tmp}'`);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }

  const old = fs
    .readdirSync(dir)
    .filter((f) => FILE_RE.test(f))
    .sort()
    .slice(0, -config.backupKeep);
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
  console.log(`Backup written: ${file}${old.length ? `, removed ${old.length} old` : ''}`);
  return file;
}

function safeRun() {
  try {
    runBackup();
  } catch (e) {
    console.error('Backup failed', e);
  }
}

/** Backup at startup, then check hourly whether a new day has begun (robust to restarts and DST). */
export function startBackupSchedule() {
  if (config.dbPath === ':memory:') return;
  safeRun();
  setInterval(safeRun, CHECK_EVERY_MS).unref();
}
