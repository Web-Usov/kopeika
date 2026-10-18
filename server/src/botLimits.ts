import { config } from './config.ts';
import { createRateLimiter } from './rateLimit.ts';

/** Per-user throttles for bot handlers; the API has its own limiter. */
export const commandLimiter = createRateLimiter({ limit: config.botCommandsPerMin });
export const inlineLimiter = createRateLimiter({ limit: config.botInlinePerMin });
// Decides whether to say "too fast" at all: once a minute per user, otherwise the reply itself would be spam.
const noticeLimiter = createRateLimiter({ limit: 1 });

/** 'ok' = handle it, 'notice' = skip and reply once, 'silent' = skip without a word. */
export function checkCommand(userId: number): 'ok' | 'notice' | 'silent' {
  if (commandLimiter.allow(userId)) return 'ok';
  return noticeLimiter.allow(userId) ? 'notice' : 'silent';
}

export function checkInline(userId: number): boolean {
  return inlineLimiter.allow(userId);
}

export function resetBotLimits() {
  commandLimiter.reset();
  inlineLimiter.reset();
  noticeLimiter.reset();
}
