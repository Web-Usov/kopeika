// Launch parameter of invite links. Invite codes are 12 chars of [A-Za-z0-9_-] (base64url), so `-` can occur inside a code
// and a short suffix alone would be ambiguous. The card suffix is therefore only recognised on a param of exactly
// INVITE_CODE_LENGTH + 2 chars; a plain code is always INVITE_CODE_LENGTH chars, so the two never collide.
export const INVITE_CODE_LENGTH = 12;
export const CARD_SUFFIX = '-c';

export type JoinSource = 'link' | 'card';

/** Start param for a link: plain code for an invite link, code + suffix for a card posted to a chat. */
export function startParamFor(code: string, source: JoinSource): string {
  return source === 'card' ? `${code}${CARD_SUFFIX}` : code;
}

/** Splits a start param into the invite code and where the person came from. Old links (plain code) are 'link'. */
export function parseStartParam(param: string): { code: string; source: JoinSource } {
  if (param.length === INVITE_CODE_LENGTH + CARD_SUFFIX.length && param.endsWith(CARD_SUFFIX))
    return { code: param.slice(0, INVITE_CODE_LENGTH), source: 'card' };
  return { code: param, source: 'link' };
}
