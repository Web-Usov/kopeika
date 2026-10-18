import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.ts';
import { parseAnswer, RECEIPT_SCHEMA, receiptInstruction, SYSTEM_PROMPT } from './common.ts';
import type { RawReceipt, ReceiptImage, ReceiptParseOptions, ReceiptProvider, ReceiptUsage } from './provider.ts';
import { ReceiptProviderError } from './provider.ts';

// Kept for older imports; the shared pieces live in common.ts.
export { parseAnswer, RECEIPT_SCHEMA, SYSTEM_PROMPT };

let cached: { client: Anthropic; key: string; baseUrl: string } | null = null;
function getClient(): Anthropic {
  const { anthropicApiKey: key, anthropicBaseUrl: baseUrl } = config;
  if (!cached || cached.key !== key || cached.baseUrl !== baseUrl) {
    cached = {
      client: new Anthropic({
        apiKey: key,
        baseURL: baseUrl || undefined,
        timeout: config.receiptsTimeoutSec * 1000,
        maxRetries: 1,
      }),
      key,
      baseUrl,
    };
  }
  return cached.client;
}

// Thinking tokens count toward max_tokens, so leave room beyond the ~100 lines of JSON.
const MAX_TOKENS = 8192;

async function parseReceipt(
  image: ReceiptImage,
  opts: ReceiptParseOptions,
): Promise<{ draft: RawReceipt; usage: ReceiptUsage }> {
  let response: Anthropic.Message;
  try {
    response = await getClient().messages.create(
      {
        model: opts.model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: RECEIPT_SCHEMA } },
        messages: [
          {
            role: 'user',
            content: [
              // The image goes before the instruction (recommended by the vision docs).
              { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
              { type: 'text', text: receiptInstruction(opts.hintCurrency) },
            ],
          },
        ],
      },
      { timeout: opts.timeoutMs },
    );
  } catch (err) {
    // Keep only the error class and status: a message could echo request details.
    if (err instanceof Anthropic.APIConnectionTimeoutError) throw new ReceiptProviderError('timeout');
    if (err instanceof Anthropic.APIError)
      throw new ReceiptProviderError('unavailable', `${err.name} ${err.status ?? ''}`.trim());
    throw new ReceiptProviderError('unavailable', err instanceof Error ? err.name : 'unknown');
  }

  // The answer is valid only when the model finished normally.
  if (response.stop_reason === 'refusal') throw new ReceiptProviderError('refusal');
  if (response.stop_reason === 'max_tokens') throw new ReceiptProviderError('truncated');
  const block = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!block) throw new ReceiptProviderError('malformed');
  return {
    draft: parseAnswer(block.text),
    usage: {
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

export const anthropicProvider: ReceiptProvider = { parseReceipt };
