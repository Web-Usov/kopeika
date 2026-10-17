import { config } from '../config.ts';
import { parseAnswer, RECEIPT_SCHEMA, receiptInstruction, SYSTEM_PROMPT } from './common.ts';
import type { RawReceipt, ReceiptImage, ReceiptParseOptions, ReceiptProvider, ReceiptUsage } from './provider.ts';
import { ReceiptProviderError } from './provider.ts';

// Reasoning tokens count toward max_tokens, so leave room beyond the ~100 lines of JSON.
const MAX_TOKENS = 8192;

interface ChatCompletion {
  model?: string;
  choices?: { finish_reason?: string | null; message?: { content?: string | null; refusal?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * OpenAI-compatible chat completions (OpenRouter; a self-hosted vLLM works through OPENROUTER_BASE_URL).
 * No SDK: one fetch. Error details are never copied from the response (it could echo the request).
 */
async function parseReceipt(
  image: ReceiptImage,
  opts: ReceiptParseOptions,
): Promise<{ draft: RawReceipt; usage: ReceiptUsage }> {
  const reasoning = opts.reasoning ?? 'none';
  const body = {
    model: opts.model,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          // The image goes before the instruction (recommended by the vision docs).
          { type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.base64}` } },
          { type: 'text', text: receiptInstruction(opts.hintCurrency) },
        ],
      },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'receipt', strict: true, schema: RECEIPT_SCHEMA } },
    // Route only to endpoints that honour the schema and do not keep or train on the photo.
    provider: {
      require_parameters: true,
      data_collection: 'deny',
      ...(config.openrouterProviders.length > 0 ? { only: config.openrouterProviders } : {}),
    },
    // Reading a receipt does not need reasoning (it triples the price). `omit` sends no field at all: models
    // without the parameter would otherwise answer 404 because of require_parameters.
    ...(reasoning === 'omit' ? {} : { reasoning: { effort: reasoning } }),
  };

  let res: Response;
  try {
    res = await fetch(`${config.openrouterBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openrouterApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : 'unknown';
    if (name === 'TimeoutError' || name === 'AbortError') throw new ReceiptProviderError('timeout');
    throw new ReceiptProviderError('unavailable', name);
  }
  // 403 is also what OpenRouter answers to regions it does not serve; 402/429/5xx are ours or the host's problem.
  if (!res.ok) throw new ReceiptProviderError('unavailable', `HTTP ${res.status}`);

  let data: ChatCompletion;
  try {
    data = (await res.json()) as ChatCompletion;
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError'))
      throw new ReceiptProviderError('timeout');
    throw new ReceiptProviderError('malformed');
  }

  const choice = data.choices?.[0];
  if (!choice) throw new ReceiptProviderError('malformed');
  if (choice.finish_reason === 'length') throw new ReceiptProviderError('truncated');
  if (choice.finish_reason === 'content_filter' || choice.message?.refusal) throw new ReceiptProviderError('refusal');
  const text = choice.message?.content;
  if (typeof text !== 'string' || text === '') throw new ReceiptProviderError('malformed');
  return {
    draft: parseAnswer(text),
    usage: {
      model: data.model ?? opts.model,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

export const openrouterProvider: ReceiptProvider = { parseReceipt };
