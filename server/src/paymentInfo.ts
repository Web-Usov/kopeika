// Payment details a person shows to those who owe them. The app never moves money: it only displays these.
import type { Key } from '../../shared/i18n/index.ts';

export interface PaymentInfo {
  phone?: string;
  bank?: string;
  card?: string;
  link?: string;
  note?: string;
}

/** Thrown with a dictionary key, translated into the user's language by the API error handler. */
export class PaymentInfoError extends Error {
  constructor(readonly key: Key) {
    super(key);
  }
}

const LIMITS = { bank: 64, note: 200, link: 500 } as const;

/** `+7XXXXXXXXXX` for Russian numbers (also from 8XXXXXXXXXX / 7XXXXXXXXXX / 9XXXXXXXXX), `+digits` otherwise. */
export function normalizePhone(raw: string): string | null {
  const s = raw.trim();
  if (!/^\+?[\d\s().-]+$/.test(s)) return null;
  const digits = s.replace(/\D/g, '');
  if (!s.startsWith('+')) {
    if (digits.length === 11 && (digits[0] === '8' || digits[0] === '7')) return `+7${digits.slice(1)}`;
    if (digits.length === 10 && digits[0] === '9') return `+7${digits}`;
  }
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

/** Card number as digits only, 16-19 of them. */
export function normalizeCard(raw: string): string | null {
  const s = raw.trim();
  if (!/^[\d\s-]+$/.test(s)) return null;
  const digits = s.replace(/\D/g, '');
  return digits.length >= 16 && digits.length <= 19 ? digits : null;
}

/** Only absolute https:// links are accepted. */
export function normalizeLink(raw: string): string | null {
  const s = raw.trim();
  if (s.length > LIMITS.link) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && u.hostname ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Validates and normalizes user input; empty fields are dropped. Throws PaymentInfoError on bad values. */
export function parsePaymentInfo(input: Record<string, string | undefined>): PaymentInfo {
  const out: PaymentInfo = {};
  const text = (v: string | undefined) => v?.trim() ?? '';
  if (text(input.phone)) {
    const v = normalizePhone(input.phone!);
    if (!v) throw new PaymentInfoError('errors.payment.phone');
    out.phone = v;
  }
  if (text(input.card)) {
    const v = normalizeCard(input.card!);
    if (!v) throw new PaymentInfoError('errors.payment.card');
    out.card = v;
  }
  if (text(input.link)) {
    const v = normalizeLink(input.link!);
    if (!v) throw new PaymentInfoError('errors.payment.link');
    out.link = v;
  }
  if (text(input.bank)) {
    if (text(input.bank).length > LIMITS.bank) throw new PaymentInfoError('errors.payment.bank');
    out.bank = text(input.bank);
  }
  if (text(input.note)) {
    if (text(input.note).length > LIMITS.note) throw new PaymentInfoError('errors.payment.note');
    out.note = text(input.note);
  }
  return out;
}

export const isEmpty = (p: PaymentInfo) => Object.keys(p).length === 0;

/** What is stored in the `payment_info` column: JSON, or NULL when there is nothing. */
export const serialize = (p: PaymentInfo): string | null => (isEmpty(p) ? null : JSON.stringify(p));

/** Reads the column back; broken or missing values give an empty object. */
export function deserialize(raw: string | null | undefined): PaymentInfo {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as PaymentInfo;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
