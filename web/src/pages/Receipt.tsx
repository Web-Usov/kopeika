import { useEffect, useRef, useState } from 'react';
import { CURRENCIES, formatMoney } from '../../../shared/money.ts';
import {
  adjustForKind,
  DRAFT_ADJUSTMENT_KINDS,
  type DraftAdjustmentKind,
  draftTotals,
  isLineValid,
  parseSignedAmount,
  type ReceiptDraft,
  signedToInput,
} from '../../../shared/receiptDraft.ts';
import { ApiError, api, type GroupDetail, type ParsedReceipt, useGroup } from '../api.ts';
import { lang, t } from '../i18n.ts';
import { getReceiptDraft, setReceiptDraft } from '../receiptDraft.ts';
import { PhotoError, type PreparedPhoto, prepareReceiptPhoto } from '../receiptPhoto.ts';
import { navigate } from '../router.ts';
import { BackButton, haptic, MainButton, openLink } from '../tg.tsx';
import { ErrorView, Loading, Money, Section, todayIso } from '../ui.tsx';
import { ReceiptAssign } from './ReceiptAssign.tsx';

type Stage =
  | { kind: 'pick' }
  | { kind: 'consent' }
  | { kind: 'reading'; phase: 'prepare' | 'upload' }
  | { kind: 'error'; message: string; retry: boolean }
  | { kind: 'edit'; parsed: ParsedReceipt | null }
  | { kind: 'next' };

export function Receipt({ groupId }: { groupId: number }) {
  const { data: g, error } = useGroup(groupId);
  const back = <BackButton onClick={() => navigate(`/g/${groupId}/expense/new`, { replace: true })} />;
  if (!g)
    return (
      <div className="page">
        {back}
        {error ? <ErrorView message={error} /> : <Loading />}
      </div>
    );
  return (
    <div className="page">
      {back}
      <Flow g={g} />
    </div>
  );
}

/** Closed beta: the group has not been approved yet. Ask for access, or wait for the owner's answer. */
function AccessGate({ g }: { g: GroupDetail }) {
  const access = g.receipts?.access ?? 'none';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ask = async () => {
    setBusy(true);
    setError('');
    try {
      await api.requestReceiptAccess(g.id);
    } catch (e) {
      haptic.error();
      setError(e instanceof ApiError ? e.message : t('receipt.access.error'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h2 className="page-title">{t('receipt.access.title')}</h2>
      <p className="hint page-subtitle">{t(`receipt.access.${access === 'approved' ? 'none' : access}`)}</p>
      {error && <ErrorView message={error} />}
      {access !== 'pending' && (
        <MainButton text={t('receipt.access.request')} loading={busy} onClick={() => void ask()} />
      )}
    </>
  );
}

function Flow({ g }: { g: GroupDetail }) {
  if (g.receipts?.beta && g.receipts.access !== 'approved') return <AccessGate g={g} />;
  return <ScanFlow g={g} />;
}

function ScanFlow({ g }: { g: GroupDetail }) {
  const [stage, setStage] = useState<Stage>({ kind: 'pick' });
  // Whether the user has already agreed (from /me). Unknown or older server: the 409 from parse tells.
  const [consented, setConsented] = useState<boolean>();
  useEffect(() => {
    api.me().then(
      (me) => setConsented(me.receiptConsent),
      () => {},
    );
  }, []);
  const photo = useRef<PreparedPhoto | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const send = async () => {
    if (!photo.current) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setStage({ kind: 'reading', phase: 'upload' });
    try {
      const parsed = await api.parseReceipt(
        g.id,
        { image: photo.current.base64, mediaType: photo.current.mediaType },
        ctl.signal,
      );
      photo.current = null; // not needed any more
      setStage({ kind: 'edit', parsed });
    } catch (e) {
      if (ctl.signal.aborted) return;
      if (e instanceof ApiError && e.status === 409) return setStage({ kind: 'consent' });
      haptic.error();
      const status = e instanceof ApiError ? e.status : undefined;
      // Another attempt only makes sense for a failure on the way; not for "not a receipt", a closed feature or a spent quota.
      setStage({ kind: 'error', message: (e as Error).message, retry: status === undefined || status >= 500 });
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setStage({ kind: 'reading', phase: 'prepare' });
    try {
      photo.current = await prepareReceiptPhoto(file);
    } catch (e) {
      photo.current = null;
      setStage({
        kind: 'error',
        message: t(e instanceof PhotoError && e.kind === 'tooLarge' ? 'receipt.photoTooLarge' : 'receipt.photoError'),
        retry: false,
      });
      return;
    }
    if (consented === false) setStage({ kind: 'consent' });
    else await send();
  };

  const consent = async () => {
    setStage({ kind: 'reading', phase: 'upload' });
    try {
      await api.giveReceiptConsent();
      setConsented(true);
    } catch (e) {
      haptic.error();
      setStage({
        kind: 'error',
        message: e instanceof ApiError && e.status !== 404 ? e.message : t('receipt.consentError'),
        retry: false,
      });
      photo.current = null;
      return;
    }
    await send();
  };

  const manual = () => {
    photo.current = null;
    setStage({ kind: 'edit', parsed: null });
  };
  const cancel = () => {
    abort.current?.abort();
    photo.current = null;
    setStage({ kind: 'pick' });
  };

  if (stage.kind === 'edit')
    return <DraftEditor g={g} initial={stage.parsed} onNext={() => setStage({ kind: 'next' })} />;

  if (stage.kind === 'next') {
    const draft = getReceiptDraft(g.id);
    const back = () => setStage({ kind: 'edit', parsed: draft ? draftToParsed(draft) : null });
    if (!draft) return <DraftEditor g={g} initial={null} onNext={() => setStage({ kind: 'next' })} />;
    return <ReceiptAssign g={g} draft={draft} onBack={back} />;
  }

  if (stage.kind === 'reading')
    return (
      <div className="center receipt-reading" role="status">
        <div className="spinner" aria-hidden="true" />
        <div>{stage.phase === 'prepare' ? t('receipt.preparing') : t('receipt.reading')}</div>
        {stage.phase === 'upload' && <div className="hint small">{t('receipt.readingHint')}</div>}
        <button type="button" className="text-btn" onClick={cancel}>
          {t('receipt.cancel')}
        </button>
      </div>
    );

  if (stage.kind === 'consent')
    return (
      <>
        <h2 className="page-title">{t('receipt.consentTitle')}</h2>
        <Section>
          <p className="row receipt-consent">{t('receipt.consentText')}</p>
          <button
            type="button"
            className="row clickable link"
            onClick={() => openLink(`${window.location.origin}/privacy?lang=${lang}`)}
          >
            {t('receipt.consentPolicy')}
          </button>
        </Section>
        <button type="button" className="text-btn" onClick={cancel}>
          {t('receipt.cancel')}
        </button>
        <MainButton text={t('receipt.consentSend')} onClick={() => void consent()} />
      </>
    );

  if (stage.kind === 'error')
    return (
      <>
        <ErrorView message={stage.message} />
        <div className="receipt-actions">
          {stage.retry && photo.current && (
            <button type="button" className="small-btn primary" onClick={() => void send()}>
              {t('receipt.retry')}
            </button>
          )}
          <button type="button" className="small-btn" onClick={cancel}>
            {t('receipt.otherPhoto')}
          </button>
          <button type="button" className="small-btn" onClick={manual}>
            {t('receipt.manual')}
          </button>
        </div>
      </>
    );

  return (
    <>
      <h2 className="page-title">{t('receipt.title')}</h2>
      <p className="hint page-subtitle">{t('receipt.pickHint')}</p>
      <Section>
        <PhotoPicker capture label={t('receipt.camera')} onFile={onFile} />
        <PhotoPicker label={t('receipt.gallery')} onFile={onFile} />
      </Section>
      <button type="button" className="text-btn" onClick={manual}>
        {t('receipt.manual')}
      </button>
    </>
  );
}

function PhotoPicker({
  label,
  capture,
  onFile,
}: {
  label: string;
  capture?: boolean;
  onFile: (f: File | undefined) => void;
}) {
  return (
    <label className="row clickable receipt-pick">
      {label}
      <input
        type="file"
        accept="image/*"
        {...(capture ? { capture: 'environment' as const } : {})}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // the same photo can be chosen again
          onFile(file);
        }}
      />
    </label>
  );
}

// --- Draft editor ---

interface ItemRow {
  key: string;
  name: string;
  amount: string;
  quantity?: string;
}
interface ExtraRow {
  key: string;
  kind: DraftAdjustmentKind;
  label: string;
  amount: string;
}

let rowCounter = 0;
const nextKey = () => `r${++rowCounter}`;

const isKind = (k: string): k is DraftAdjustmentKind => (DRAFT_ADJUSTMENT_KINDS as readonly string[]).includes(k);

function draftToParsed(d: ReceiptDraft): ParsedReceipt {
  return {
    merchant: d.merchant,
    date: d.date,
    currency: d.currency,
    items: d.items,
    adjustments: d.adjustments.map((a) => ({ kind: a.kind, label: a.label, amount: a.amount, percent: null })),
    total: d.total,
    mismatch: false,
    confidence: 'high',
    warnings: [],
  };
}

const WARNING_TEXT: Record<string, Parameters<typeof t>[0]> = {
  qty_mismatch: 'receipt.warnQtyMismatch',
  truncated: 'receipt.warnTruncated',
  skipped_lines: 'receipt.warnSkipped',
  dropped_total_line: 'receipt.warnDroppedTotal',
};

function DraftEditor({ g, initial, onNext }: { g: GroupDetail; initial: ParsedReceipt | null; onNext: () => void }) {
  const [merchant, setMerchant] = useState(initial?.merchant ?? '');
  const [date, setDate] = useState(initial?.date ?? '');
  const [currency, setCurrency] = useState(initial ? (initial.currency ?? '') : g.currency);
  const [items, setItems] = useState<ItemRow[]>(() =>
    initial
      ? initial.items.map((i) => ({
          key: nextKey(),
          name: i.name,
          amount: signedToInput(i.amount),
          quantity: i.quantity,
        }))
      : [{ key: nextKey(), name: '', amount: '' }],
  );
  const [extras, setExtras] = useState<ExtraRow[]>(() =>
    (initial?.adjustments ?? []).map((a) => ({
      key: nextKey(),
      kind: isKind(a.kind) ? a.kind : 'other',
      label: a.label,
      amount: signedToInput(a.amount),
    })),
  );
  const [printed, setPrinted] = useState(initial?.total != null ? signedToInput(initial.total) : '');

  const patchItem = (key: string, patch: Partial<ItemRow>) =>
    setItems((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const patchExtra = (key: string, patch: Partial<ExtraRow>) =>
    setExtras((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const itemAmounts = items.map((r) => parseSignedAmount(r.amount) ?? 0);
  const extraAmounts = extras.map((r) => parseSignedAmount(r.amount) ?? 0);
  const printedValue = printed.trim() === '' ? null : parseSignedAmount(printed);
  const printedBad = printed.trim() !== '' && printedValue === null;
  const totals = draftTotals(itemAmounts, extraAmounts, printedValue);
  const mismatch = totals.diff !== null && totals.diff !== 0;

  const linesOk = items.length > 0 && items.every((r) => isLineValid(r.name, r.amount));
  const extrasOk = extras.every((r) => {
    const v = parseSignedAmount(r.amount);
    return v !== null && v !== 0;
  });
  const valid = linesOk && extrasOk && !printedBad && !mismatch && currency !== '' && totals.sum > 0;

  const money = (v: number) => formatMoney(Math.abs(v), currency || g.currency, lang);
  const cur = currency || g.currency;

  const hints: string[] = [];
  if (initial?.confidence === 'low' || initial?.warnings.includes('low_confidence'))
    hints.push(t('receipt.warnLowConfidence'));
  for (const w of initial?.warnings ?? []) if (WARNING_TEXT[w]) hints.push(t(WARNING_TEXT[w]));

  const next = () => {
    const draft: ReceiptDraft = {
      merchant: merchant.trim(),
      date,
      currency,
      items: items.map((r, i) => ({
        id: `i${i + 1}`,
        name: r.name.trim(),
        ...(r.quantity ? { quantity: r.quantity } : {}),
        amount: parseSignedAmount(r.amount) ?? 0,
      })),
      adjustments: extras.map((r, i) => ({
        id: `a${i + 1}`,
        kind: r.kind,
        label: r.label,
        amount: parseSignedAmount(r.amount) ?? 0,
      })),
      total: printedValue,
    };
    setReceiptDraft(g.id, draft);
    haptic.success();
    onNext();
  };

  return (
    <>
      <h2 className="page-title">{t('receipt.title')}</h2>

      {hints.length > 0 && (
        <div className="banner receipt-warn" role="status">
          {hints.map((h) => (
            <div key={h}>{h}</div>
          ))}
        </div>
      )}

      <Section>
        <input
          className="field"
          placeholder={t('receipt.merchantPlaceholder')}
          aria-label={t('receipt.merchantPlaceholder')}
          value={merchant}
          maxLength={100}
          onChange={(e) => setMerchant(e.target.value)}
        />
        <input
          className="field"
          type="date"
          aria-label={t('receipt.dateLabel')}
          value={date}
          max={todayIso()}
          onChange={(e) => setDate(e.target.value)}
        />
        <select
          className={`field ${currency === '' ? 'invalid' : ''}`}
          aria-label={t('receipt.currencyLabel')}
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        >
          {currency === '' && <option value="">{t('receipt.currencyPick')}</option>}
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {currency === '' && <div className="field-error">{t('receipt.currencyMissing')}</div>}
      </Section>

      <Section
        title={t('receipt.itemsTitle')}
        footer={
          !linesOk ? (
            <span className={items.length > 0 ? 'neg' : undefined}>
              {items.length === 0 ? t('receipt.noItems') : t('receipt.lineError')}
            </span>
          ) : undefined
        }
      >
        {items.map((r) => {
          const bad = !isLineValid(r.name, r.amount);
          return (
            <div className="row receipt-line" key={r.key}>
              <div className="receipt-main">
                <input
                  className="field receipt-name"
                  placeholder={t('receipt.itemName')}
                  aria-label={t('receipt.itemName')}
                  value={r.name}
                  maxLength={100}
                  onChange={(e) => patchItem(r.key, { name: e.target.value })}
                />
                {r.quantity && <span className="hint small">×{r.quantity}</span>}
              </div>
              <input
                className={`field exact ${bad && r.amount.trim() !== '' ? 'invalid' : ''}`}
                inputMode="decimal"
                placeholder="0"
                aria-label={t('receipt.itemAmount')}
                value={r.amount}
                onChange={(e) => patchItem(r.key, { amount: e.target.value })}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={t('receipt.itemDelete')}
                onClick={() => setItems((rows) => rows.filter((x) => x.key !== r.key))}
              >
                ✕
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="row clickable link"
          onClick={() => setItems((rows) => [...rows, { key: nextKey(), name: '', amount: '' }])}
        >
          {t('receipt.addItem')}
        </button>
      </Section>

      <Section title={t('receipt.extrasTitle')} footer={t('receipt.extrasFooter')}>
        {extras.map((r) => (
          <div className="row receipt-line" key={r.key}>
            <div className="receipt-main">
              <select
                className="field receipt-name"
                aria-label={t('receipt.extrasTitle')}
                value={r.kind}
                onChange={(e) => {
                  const kind = e.target.value as DraftAdjustmentKind;
                  const v = parseSignedAmount(r.amount);
                  patchExtra(r.key, { kind, ...(v !== null ? { amount: signedToInput(adjustForKind(kind, v)) } : {}) });
                }}
              >
                {DRAFT_ADJUSTMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`receipt.kind.${k}`)}
                  </option>
                ))}
              </select>
              {r.label && <span className="hint small receipt-label">{r.label}</span>}
            </div>
            <input
              className={`field exact ${r.amount.trim() !== '' && !parseSignedAmount(r.amount) ? 'invalid' : ''}`}
              inputMode="decimal"
              placeholder="0"
              aria-label={t('receipt.extraAmount')}
              value={r.amount}
              onChange={(e) => {
                const v = parseSignedAmount(e.target.value);
                patchExtra(r.key, {
                  amount:
                    v !== null && v !== 0 && r.kind === 'discount' && v > 0 ? `-${e.target.value}` : e.target.value,
                });
              }}
            />
            <button
              type="button"
              className="icon-btn"
              aria-label={t('receipt.extraDelete')}
              onClick={() => setExtras((rows) => rows.filter((x) => x.key !== r.key))}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className="row clickable link"
          onClick={() => setExtras((rows) => [...rows, { key: nextKey(), kind: 'service', label: '', amount: '' }])}
        >
          {t('receipt.addExtra')}
        </button>
      </Section>

      <Section title={t('receipt.totalTitle')}>
        <div className="row">
          <span className="row-main">{t('receipt.sumLabel')}</span>
          <span className="row-right receipt-sum">
            <Money value={totals.sum} currency={cur} />
          </span>
        </div>
        <div className="row">
          <span className="row-main">{t('receipt.printedLabel')}</span>
          <input
            className={`field exact ${printedBad ? 'invalid' : ''}`}
            inputMode="decimal"
            placeholder={t('receipt.printedPlaceholder')}
            aria-label={t('receipt.printedLabel')}
            value={printed}
            onChange={(e) => setPrinted(e.target.value)}
          />
        </div>
        {printedValue !== null && (
          <div className={`row receipt-check ${mismatch ? 'neg' : 'pos'}`} role="status">
            {mismatch
              ? t('receipt.mismatch', {
                  printed: money(printedValue),
                  sum: money(totals.sum),
                  diff: money(totals.diff ?? 0),
                })
              : t('receipt.matches')}
          </div>
        )}
        {mismatch && printedValue !== null && (
          <div className="row buttons receipt-fix">
            <button type="button" className="small-btn" onClick={() => setPrinted('')}>
              {t('receipt.acceptSum')}
            </button>
            <button
              type="button"
              className="small-btn"
              onClick={() =>
                setExtras((rows) => [
                  ...rows,
                  {
                    key: nextKey(),
                    kind: 'other',
                    label: t('receipt.otherLabel'),
                    amount: signedToInput(printedValue - totals.sum),
                  },
                ])
              }
            >
              {t('receipt.addOther')}
            </button>
          </div>
        )}
      </Section>

      <MainButton text={t('receipt.next')} onClick={next} disabled={!valid} />
    </>
  );
}
