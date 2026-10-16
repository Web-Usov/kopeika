// The receipt draft being worked on, per group. Lives in memory only (a reload starts over):
// the draft editor writes it, the "who ate what" step (#104) reads it.
import type { ReceiptDraft } from '../../shared/receiptDraft.ts';

const drafts = new Map<number, ReceiptDraft>();

export const getReceiptDraft = (groupId: number): ReceiptDraft | undefined => drafts.get(groupId);

export function setReceiptDraft(groupId: number, draft: ReceiptDraft | null) {
  if (draft) drafts.set(groupId, draft);
  else drafts.delete(groupId);
}
