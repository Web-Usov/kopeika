import { GrammyError, HttpError } from 'grammy';

/**
 * Safe description of an error from a Telegram call. GrammyError carries the request `payload`
 * (message text: group names, amounts, names), so it is never logged as an object: only the method,
 * the error code and Telegram's description.
 */
export function describeTelegramError(e: unknown): string {
  if (e instanceof GrammyError) return `${e.method} ${e.error_code} ${e.description}`;
  if (e instanceof HttpError) return `network error: ${e.message}`;
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : 'unknown error';
}

/** Telegram API errors are reduced to method/code/description; anything else (a bug) keeps its full stack trace. */
export function logTelegramError(context: string, e: unknown) {
  if (e instanceof GrammyError || e instanceof HttpError) console.warn(`${context}: ${describeTelegramError(e)}`);
  else console.error(context, e);
}
