import { config, type ReasoningMode } from '../config.ts';
import { ApiError, fail } from '../errors.ts';
import { mismatchSize, normalizeReceipt, ReceiptContentError, type ReceiptDraft } from './normalize.ts';
import {
  getReceiptProvider,
  type ReceiptImage,
  type ReceiptMediaType,
  ReceiptProviderError,
  type ReceiptUsage,
  receiptsEnabled,
} from './provider.ts';

export const MEDIA_TYPES: readonly ReceiptMediaType[] = ['image/jpeg', 'image/webp', 'image/png'];

/** Magic bytes, so that the declared media type is not taken on trust. */
export function matchesSignature(bytes: Uint8Array, mediaType: ReceiptMediaType): boolean {
  const at = (i: number, ...sig: number[]) => sig.every((b, k) => bytes[i + k] === b);
  if (mediaType === 'image/jpeg') return at(0, 0xff, 0xd8, 0xff);
  if (mediaType === 'image/png') return at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  return at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50); // RIFF....WEBP
}

/**
 * Photo -> draft. The photo exists only in memory for the duration of the call; nothing here writes or logs it.
 * Throws ApiError (translated by the API error handler).
 */
export async function scanReceipt(
  image: ReceiptImage,
  groupCurrency: string,
  /** Called after every provider call that returned (also when the photo turns out not to be a receipt). */
  onUsage: (usage: ReceiptUsage) => void,
): Promise<ReceiptDraft> {
  if (!receiptsEnabled()) throw fail(503, 'errors.receipt.disabled');
  const provider = getReceiptProvider();

  async function attempt(model: string, reasoning: ReasoningMode): Promise<ReceiptDraft> {
    try {
      const { draft, usage } = await provider.parseReceipt(image, {
        model,
        timeoutMs: config.receiptsTimeoutSec * 1000,
        hintCurrency: groupCurrency,
        reasoning,
      });
      onUsage(usage);
      return normalizeReceipt(draft, { groupCurrency });
    } catch (err) {
      if (err instanceof ReceiptContentError) {
        throw fail(400, err.kind === 'notReceipt' ? 'errors.receipt.notReceipt' : 'errors.receipt.unreadable');
      }
      if (err instanceof ApiError) throw err;
      // Only the reason and the model are logged: never the photo, its contents or the key.
      console.error(
        `Receipt recognition failed (${model}): ${err instanceof ReceiptProviderError ? err.message : 'unexpected error'}`,
      );
      throw fail(502, 'errors.receipt.providerFailed');
    }
  }

  let draft = await attempt(config.receiptsModel, config.receiptsReasoning);
  const fallback = config.receiptsFallbackModel;
  // The same model is a valid second step on openrouter when only the reasoning mode differs.
  const differs =
    fallback !== config.receiptsModel ||
    (config.receiptsProvider === 'openrouter' && config.receiptsFallbackReasoning !== config.receiptsReasoning);
  if (draft.mismatch && fallback && differs) {
    // The sum does not add up: ask the stronger model once and keep the closer attempt. A failed retry is not an error.
    try {
      const second = await attempt(fallback, config.receiptsFallbackReasoning);
      if (mismatchSize(second) < mismatchSize(draft)) draft = second;
    } catch {
      // keep the first attempt
    }
  }
  return draft;
}
