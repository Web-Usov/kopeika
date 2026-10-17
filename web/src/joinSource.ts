import type { JoinSource } from '../../shared/invite.ts';

/** Where the person came from (invite link or a card in a chat); set at launch from the start param, sent with the join request. */
export const joinSource: { value: JoinSource } = { value: 'link' };
