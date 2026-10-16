// Import this FIRST in any test that (transitively) imports db.ts: static imports run in order,
// so the env is set before config.ts and db.ts read it. Tests must never touch data/kopeika.db.
process.env.DB_PATH ??= ':memory:';
