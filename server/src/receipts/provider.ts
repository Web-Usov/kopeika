import { config } from '../config.ts';
import { anthropicProvider } from './anthropic.ts';

export type ReceiptMediaType = 'image/jpeg' | 'image/webp' | 'image/png';

export interface ReceiptImage {
  mediaType: ReceiptMediaType;
  /** Base64 without the data: prefix. Held in memory for the duration of the call only. */
  base64: string;
}

export interface ReceiptParseOptions {
  model: string;
  timeoutMs: number;
  /** The group's currency: a weak hint, used only when the receipt shows none. */
  hintCurrency?: string;
}

/** What the model read off the photo, exactly as printed: amounts are still decimal strings in any notation. */
export interface RawReceipt {
  isReceipt: boolean;
  merchant: string | null;
  date: string | null;
  currencyHint: string | null;
  items: { name: string; qty: string; unitPrice: string | null; lineTotal: string }[];
  extras: { kind: string; label: string; amount: string; percent: string | null }[];
  printedSubtotal: string | null;
  printedTotal: string | null;
  confidence: 'high' | 'medium' | 'low';
}

export interface ReceiptUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** The provider boundary: swap the implementation (another vendor, a separate service) without touching the API. */
export interface ReceiptProvider {
  parseReceipt(image: ReceiptImage, opts: ReceiptParseOptions): Promise<{ draft: RawReceipt; usage: ReceiptUsage }>;
}

/** The provider failed (network, timeout, 5xx, refusal, truncated or malformed answer). Carries no photo data. */
export class ReceiptProviderError extends Error {
  constructor(
    readonly reason: 'timeout' | 'unavailable' | 'refusal' | 'truncated' | 'malformed',
    detail?: string,
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
  }
}

let testProvider: ReceiptProvider | null = null;

/** Tests inject a fake provider (no network, ever). Call with no argument to reset. */
export function setReceiptProviderForTests(p?: ReceiptProvider) {
  testProvider = p ?? null;
}

/** The feature is on when a key is configured (or a test provider is injected). */
export const receiptsEnabled = () => testProvider !== null || config.anthropicApiKey !== '';

export const getReceiptProvider = (): ReceiptProvider => testProvider ?? anthropicProvider;
