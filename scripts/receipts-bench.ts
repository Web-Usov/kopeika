// Receipt-recognition benchmark over a folder of your own photos (never commit them). Not part of CI:
//   OPENROUTER_API_KEY=... npx tsx scripts/receipts-bench.ts <photos-dir> [--models a,b,c] [--currency RUB] [--runs 1]
// Prints, per model: share of receipts whose lines add up to the printed total (the app's own normalization),
// tokens, latency p50/p95 and price per scan (prices come from the /models list of the API; n/a if unknown).
import fs from 'node:fs';
import path from 'node:path';

const { config } = await import('../server/src/config.ts');
const { openrouterProvider } = await import('../server/src/receipts/openrouter.ts');
const { normalizeReceipt, ReceiptContentError } = await import('../server/src/receipts/normalize.ts');
const { ReceiptProviderError } = await import('../server/src/receipts/provider.ts');

const DEFAULT_MODELS = [
  'google/gemma-4-26b-a4b-it',
  'google/gemma-4-31b-it',
  'mistralai/mistral-small-3.2-24b-instruct',
  'qwen/qwen3.5-flash-02-23',
];
const MEDIA = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' } as const;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!dir) {
  console.error('Usage: npx tsx scripts/receipts-bench.ts <photos-dir> [--models a,b] [--currency RUB] [--runs 1]');
  process.exit(1);
}
if (!config.openrouterApiKey) {
  console.error('Set OPENROUTER_API_KEY (and OPENROUTER_BASE_URL for your own server).');
  process.exit(1);
}
const models =
  flag('models')
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? DEFAULT_MODELS;
const currency = flag('currency') ?? 'RUB';
const runs = Math.max(1, Number(flag('runs') ?? 1));
const timeoutMs = config.receiptsTimeoutSec * 1000;

const files = fs
  .readdirSync(dir)
  .filter((f) => path.extname(f).toLowerCase() in MEDIA)
  .sort();
if (files.length === 0) {
  console.error(`No jpg/png/webp photos in ${dir}`);
  process.exit(1);
}

/** USD per 1M tokens from the provider's model list; {} entries are unknown. */
async function loadPrices(): Promise<Record<string, { in: number; out: number }>> {
  try {
    const res = await fetch(`${config.openrouterBaseUrl}/models`, {
      headers: { Authorization: `Bearer ${config.openrouterApiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json()) as { data?: { id: string; pricing?: { prompt?: string; completion?: string } }[] };
    const out: Record<string, { in: number; out: number }> = {};
    for (const m of data.data ?? []) {
      const i = Number(m.pricing?.prompt);
      const o = Number(m.pricing?.completion);
      if (Number.isFinite(i) && Number.isFinite(o)) out[m.id] = { in: i * 1e6, out: o * 1e6 };
    }
    return out;
  } catch {
    return {};
  }
}

const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] as number;
};
const fmt = (n: number, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : 'n/a');

const prices = await loadPrices();
const rows: string[][] = [];
for (const model of models) {
  let ok = 0;
  let mismatch = 0;
  let failed = 0;
  let notReceipt = 0;
  const lat: number[] = [];
  const tin: number[] = [];
  const tout: number[] = [];
  console.error(`# ${model}`);
  for (const f of files) {
    const base64 = fs.readFileSync(path.join(dir, f)).toString('base64');
    const mediaType = MEDIA[path.extname(f).toLowerCase() as keyof typeof MEDIA];
    for (let r = 0; r < runs; r++) {
      const t0 = performance.now();
      try {
        const { draft, usage } = await openrouterProvider.parseReceipt(
          { mediaType, base64 },
          { model, timeoutMs, hintCurrency: currency },
        );
        lat.push(performance.now() - t0);
        tin.push(usage.inputTokens);
        tout.push(usage.outputTokens);
        const d = normalizeReceipt(draft, { groupCurrency: currency });
        if (d.mismatch) mismatch++;
        else ok++;
      } catch (err) {
        if (err instanceof ReceiptContentError) {
          notReceipt++;
          console.error(`  ${f}: ${err.kind}`);
        } else {
          failed++;
          console.error(`  ${f}: ${err instanceof ReceiptProviderError ? err.message : 'unexpected error'}`);
        }
      }
    }
  }
  const n = files.length * runs;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN);
  const price = prices[model];
  const perScan = price ? (avg(tin) * price.in + avg(tout) * price.out) / 1e6 : Number.NaN;
  rows.push([
    model,
    `${ok}/${n} (${fmt((100 * ok) / n)}%)`,
    String(mismatch),
    String(notReceipt + failed),
    fmt(avg(tin)),
    fmt(avg(tout)),
    fmt(pct(lat, 0.5)),
    fmt(pct(lat, 0.95)),
    Number.isFinite(perScan) ? `$${(perScan * 1000).toFixed(2)}` : 'n/a',
  ]);
}

const header = ['model', 'sum ok', 'mismatch', 'errors', 'tok in', 'tok out', 'p50 ms', 'p95 ms', '$/1000 scans'];
const table = [header, ...rows];
const w = header.map((_, c) => Math.max(...table.map((r) => (r[c] as string).length)));
for (const r of table) console.log(r.map((cell, c) => cell.padEnd(w[c] as number)).join('  '));
