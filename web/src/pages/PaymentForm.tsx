import { useState } from 'react';
import type { PaymentInfo } from '../api.ts';
import { t } from '../i18n.ts';
import { alertDialog, haptic } from '../tg.tsx';
import { Section } from '../ui.tsx';

const FIELDS = [
  { key: 'phone', label: 'payment.phone', placeholder: 'payment.phonePlaceholder', type: 'tel', max: 40 },
  { key: 'bank', label: 'payment.bank', placeholder: 'payment.bankPlaceholder', type: 'text', max: 64 },
  { key: 'card', label: 'payment.card', placeholder: 'payment.card', type: 'text', max: 40 },
  { key: 'link', label: 'payment.link', placeholder: 'payment.link', type: 'url', max: 500 },
  { key: 'note', label: 'payment.note', placeholder: 'payment.note', type: 'text', max: 200 },
] as const;

/** Form for payment details: phone, bank, card, link, note. `onSave` returns the normalized values. */
export function PaymentForm(props: {
  title?: string;
  footer?: string;
  /** Without the section frame, to embed into another list. */
  bare?: boolean;
  initial: PaymentInfo;
  onSave: (info: PaymentInfo) => Promise<PaymentInfo>;
}) {
  const [saved, setSaved] = useState(props.initial);
  const [values, setValues] = useState<PaymentInfo>(props.initial);
  const [justSaved, setJustSaved] = useState(false);
  const dirty = FIELDS.some((f) => (values[f.key] ?? '') !== (saved[f.key] ?? ''));

  const save = async () => {
    try {
      const next = await props.onSave(values);
      setSaved(next);
      setValues(next);
      setJustSaved(true);
      haptic.success();
      setTimeout(() => setJustSaved(false), 2000);
    } catch (e) {
      haptic.error();
      await alertDialog((e as Error).message);
    }
  };

  const body = (
    <>
      {FIELDS.map((f) => (
        <input
          key={f.key}
          className="field"
          type={f.type}
          aria-label={t(f.label)}
          placeholder={t(f.placeholder)}
          maxLength={f.max}
          value={values[f.key] ?? ''}
          onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
        />
      ))}
      <div className="row buttons">
        <button type="button" className="small-btn primary" disabled={!dirty} onClick={save}>
          {justSaved ? t('payment.saved') : t('common.save')}
        </button>
      </div>
    </>
  );
  return props.bare ? (
    body
  ) : (
    <Section title={props.title} footer={props.footer}>
      {body}
    </Section>
  );
}
