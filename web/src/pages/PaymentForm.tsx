import { useState } from 'react';
import type { PaymentInfo } from '../api.ts';
import { t } from '../i18n.ts';
import { alertDialog, haptic } from '../tg.tsx';
import { Button, FieldRow, Section } from '../ui.tsx';

const FIELDS = [
  { key: 'phone', label: 'payment.phone', placeholder: 'payment.phonePlaceholder', type: 'tel', max: 40 },
  { key: 'bank', label: 'payment.bank', placeholder: 'payment.bankPlaceholder', type: 'text', max: 64 },
  { key: 'card', label: 'payment.card', placeholder: 'payment.cardPlaceholder', type: 'text', max: 40 },
  { key: 'link', label: 'payment.link', placeholder: 'payment.linkPlaceholder', type: 'url', max: 500 },
  { key: 'note', label: 'payment.note', placeholder: 'payment.notePlaceholder', type: 'text', max: 200 },
] as const;

/**
 * Form for payment details: phone, bank, card, link, note (`FieldRow` ×5).
 * `onSave` returns the normalized values. With `onCancel` there are two buttons under the fields («Отмена» + «Сохранить»);
 * without it the form is embedded (group settings) and shows one «Сохранить».
 */
export function PaymentForm(props: {
  title?: string;
  footer?: string;
  /** Without the section frame, to embed into another list. */
  bare?: boolean;
  initial: PaymentInfo;
  onSave: (info: PaymentInfo) => Promise<PaymentInfo>;
  onCancel?: () => void;
}) {
  const [saved, setSaved] = useState(props.initial);
  const [values, setValues] = useState<PaymentInfo>(props.initial);
  const [justSaved, setJustSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const dirty = FIELDS.some((f) => (values[f.key] ?? '') !== (saved[f.key] ?? ''));

  const save = async () => {
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  };

  const fields = FIELDS.map((f) => (
    <FieldRow
      key={f.key}
      label={t(f.label)}
      type={f.type}
      placeholder={t(f.placeholder)}
      maxLength={f.max}
      value={values[f.key] ?? ''}
      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
    />
  ));
  const buttons = (
    <div className="pay-buttons">
      {props.onCancel && (
        <Button variant="fill" wide onClick={props.onCancel}>
          {t('payment.cancel')}
        </Button>
      )}
      <Button variant="primary" wide disabled={!dirty} loading={busy} onClick={save}>
        {justSaved ? t('payment.saved') : t('common.save')}
      </Button>
    </div>
  );
  if (props.bare)
    return (
      <>
        {fields}
        <div className="row buttons">{buttons}</div>
      </>
    );
  return (
    <div className="pay-form">
      <Section title={props.title}>{fields}</Section>
      {buttons}
      {props.footer && <div className="section-footer">{props.footer}</div>}
    </div>
  );
}
