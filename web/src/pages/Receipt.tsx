import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { CURRENCIES, formatMoney } from '../../../shared/money.ts';
import type { ReceiptsProvider } from '../../../shared/privacy.ts';
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
import { Icon } from '../icons.tsx';
import { getReceiptDraft, setReceiptDraft } from '../receiptDraft.ts';
import { PhotoError, type PreparedPhoto, prepareReceiptPhoto } from '../receiptPhoto.ts';
import { navigate } from '../router.ts';
import { BackButton, haptic, MainButton, openLink } from '../tg.tsx';
import {
  BigField,
  Box,
  Button,
  Card,
  currencyLabel,
  EmptyState,
  ErrorView,
  formatDay,
  IconButton,
  Loading,
  Money,
  OkLine,
  PhotoTile,
  PhotoTiles,
  PickRow,
  Row,
  Screen,
  ScreenTitle,
  Section,
  Tips,
  todayIso,
} from '../ui.tsx';
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
      <Screen>
        {back}
        {error ? <ErrorView message={error} /> : <Loading />}
      </Screen>
    );
  return (
    <Screen>
      {back}
      <Flow g={g} />
    </Screen>
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
      <ScreenTitle lead={t(`receipt.access.${access === 'approved' ? 'none' : access}`)}>
        {t('receipt.access.title')}
      </ScreenTitle>
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
  // Named on the consent screen; unknown (no /me answer) gets the text that points to the policy.
  const [provider, setProvider] = useState<ReceiptsProvider>();
  useEffect(() => {
    api.me().then(
      (me) => {
        setConsented(me.receiptConsent);
        setProvider(me.receiptsProvider);
      },
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
      <div role="status">
        <EmptyState
          icon="receipt"
          title={stage.phase === 'prepare' ? t('receipt.preparing') : t('receipt.reading')}
          hint={stage.phase === 'upload' ? t('receipt.readingHint') : undefined}
        >
          <Button variant="ghost" onClick={cancel}>
            {t('receipt.cancel')}
          </Button>
        </EmptyState>
      </div>
    );

  if (stage.kind === 'consent')
    return (
      <>
        <ScreenTitle>{t('receipt.consentTitle')}</ScreenTitle>
        <Section>
          <p className="receipt-consent">
            {t(
              provider === 'openrouter'
                ? 'receipt.consentTextOpenrouter'
                : provider === 'anthropic'
                  ? 'receipt.consentTextAnthropic'
                  : 'receipt.consentText',
            )}
          </p>
          <Row
            tone="link"
            left={<Icon name="shield" size={20} />}
            title={t('receipt.consentPolicy')}
            onClick={() => openLink(`${window.location.origin}/privacy?lang=${lang}`)}
          />
        </Section>
        <MainButton
          text={t('receipt.consentSend')}
          onClick={() => void consent()}
          above={
            <Button variant="ghost" wide onClick={cancel}>
              {t('receipt.cancel')}
            </Button>
          }
        />
      </>
    );

  if (stage.kind === 'error')
    return (
      <>
        <ErrorView message={stage.message} />
        <div className="receipt-actions">
          {stage.retry && photo.current && (
            <Button wide onClick={() => void send()}>
              {t('receipt.retry')}
            </Button>
          )}
          <Button variant="fill" wide onClick={cancel}>
            {t('receipt.otherPhoto')}
          </Button>
          <Button variant="ghost" wide onClick={manual}>
            {t('receipt.manual')}
          </Button>
        </div>
      </>
    );

  const q = g.receipts;
  const left = q && !q.unlimited && q.limit > 0 ? Math.max(0, q.limit - q.used) : null;
  return (
    <>
      <ScreenTitle lead={t('receipt.pickHint')}>{t('receipt.title')}</ScreenTitle>
      <PhotoTiles>
        <PhotoTile capture icon="camera" label={t('receipt.camera')} onFile={onFile} />
        <PhotoTile icon="image" label={t('receipt.gallery')} onFile={onFile} />
      </PhotoTiles>
      <Tips items={[t('receipt.tipWhole'), t('receipt.tipFlat'), t('receipt.tipGlare')]} />
      <div className="receipt-start-foot">
        <Button variant="ghost" onClick={manual}>
          {t('receipt.manual')}
        </Button>
        {left !== null && (
          <div className="receipt-left">
            {t('receipt.limitLeft', { left, limit: q?.limit ?? 0, count: q?.limit ?? 0 })}
          </div>
        )}
      </div>
    </>
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

/**
 * Поле суммы в строке чека: пока не в фокусе — «2 400 ₽» (знак минуса настоящий), при фокусе — число для правки.
 * Пустое и нечитаемое остаются как введены.
 */
function MoneyBox({
  value,
  currency,
  onChange,
  invalid,
  placeholder,
  'aria-label': label,
}: {
  value: string;
  currency: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  invalid: boolean;
  placeholder: string;
  'aria-label': string;
}) {
  const [focused, setFocused] = useState(false);
  const minor = parseSignedAmount(value);
  const shown =
    !focused && minor !== null && value.trim() !== '' ? formatMoney(minor, currency, lang).replace(/^-/, '−') : value;
  return (
    <Box
      narrow
      inputMode={focused ? 'decimal' : undefined}
      placeholder={placeholder}
      aria-label={label}
      invalid={invalid}
      value={shown}
      onFocus={(e) => {
        const input = e.target;
        flushSync(() => setFocused(true)); // swap «2 400 ₽» for the number before the caret is placed
        input.select();
      }}
      onBlur={() => setFocused(false)}
      onChange={onChange}
    />
  );
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
      <ScreenTitle>{t('receipt.title')}</ScreenTitle>

      {hints.length > 0 && (
        <Card className="receipt-warn">
          <span className="receipt-warn-ic" aria-hidden="true">
            <Icon name="info" size={20} stroke={2} />
          </span>
          <div role="status">
            {hints.map((h) => (
              <div key={h}>{h}</div>
            ))}
          </div>
        </Card>
      )}

      <Section
        inset={60}
        footer={currency === '' ? <span className="neg">{t('receipt.currencyMissing')}</span> : undefined}
      >
        <BigField
          label={t('receipt.merchantLabel')}
          placeholder={t('receipt.merchantPlaceholder')}
          value={merchant}
          maxLength={100}
          onChange={(e) => setMerchant(e.target.value)}
        />
        <PickRow
          icon="calendar"
          title={t('receipt.dateLabel')}
          value={date ? formatDay(date) : t('receipt.dateNone')}
          muted={!date}
          native={
            <input
              className="pick-native"
              type="date"
              aria-label={t('receipt.dateLabel')}
              value={date}
              max={todayIso()}
              onChange={(e) => setDate(e.target.value)}
              onClick={(e) => {
                try {
                  e.currentTarget.showPicker?.();
                } catch {
                  // the native picker opens on its own where showPicker is unavailable
                }
              }}
            />
          }
        />
        <PickRow
          icon="globe"
          title={t('receipt.currencyLabel')}
          value={currency ? currencyLabel(currency) : t('receipt.currencyPick')}
          muted={currency === ''}
          native={
            <select
              className="pick-native"
              aria-label={t('receipt.currencyLabel')}
              aria-invalid={currency === '' || undefined}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {currency === '' && <option value="">{t('receipt.currencyPick')}</option>}
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {currencyLabel(c)}
                </option>
              ))}
            </select>
          }
        />
      </Section>

      <Section
        title={`${t('receipt.itemsTitle')} · ${items.length}`}
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
            <Row
              key={r.key}
              className="receipt-line"
              title={
                <input
                  className="receipt-name"
                  placeholder={t('receipt.itemName')}
                  aria-label={t('receipt.itemName')}
                  value={r.name}
                  maxLength={100}
                  onChange={(e) => patchItem(r.key, { name: e.target.value })}
                />
              }
              subtitle={r.quantity ? `×${r.quantity}` : undefined}
              right={
                <>
                  <MoneyBox
                    currency={cur}
                    placeholder="0"
                    aria-label={t('receipt.itemAmount')}
                    invalid={bad && r.amount.trim() !== ''}
                    value={r.amount}
                    onChange={(e) => patchItem(r.key, { amount: e.target.value })}
                  />
                  <IconButton
                    icon="x"
                    variant="mute"
                    label={t('receipt.itemDelete')}
                    onClick={() => setItems((rows) => rows.filter((x) => x.key !== r.key))}
                  />
                </>
              }
            />
          );
        })}
        <Row
          tone="link"
          left={<Icon name="plus" size={20} stroke={2.2} />}
          title={t('receipt.addItem')}
          onClick={() => setItems((rows) => [...rows, { key: nextKey(), name: '', amount: '' }])}
        />
      </Section>

      <Section title={t('receipt.extrasTitle')} footer={t('receipt.extrasFooter')}>
        {extras.map((r) => (
          <Row
            key={r.key}
            className="receipt-line"
            title={
              <span className="receipt-kind">
                <select
                  aria-label={t('receipt.extrasTitle')}
                  value={r.kind}
                  onChange={(e) => {
                    const kind = e.target.value as DraftAdjustmentKind;
                    const v = parseSignedAmount(r.amount);
                    patchExtra(r.key, {
                      kind,
                      ...(v !== null ? { amount: signedToInput(adjustForKind(kind, v)) } : {}),
                    });
                  }}
                >
                  {DRAFT_ADJUSTMENT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`receipt.kind.${k}`)}
                    </option>
                  ))}
                </select>
                <Icon name="down" size={16} stroke={2.2} />
              </span>
            }
            subtitle={r.label || undefined}
            right={
              <>
                <MoneyBox
                  currency={cur}
                  placeholder="0"
                  aria-label={t('receipt.extraAmount')}
                  invalid={r.amount.trim() !== '' && !parseSignedAmount(r.amount)}
                  value={r.amount}
                  onChange={(e) => {
                    const v = parseSignedAmount(e.target.value);
                    patchExtra(r.key, {
                      amount:
                        v !== null && v !== 0 && r.kind === 'discount' && v > 0 ? `-${e.target.value}` : e.target.value,
                    });
                  }}
                />
                <IconButton
                  icon="x"
                  variant="mute"
                  label={t('receipt.extraDelete')}
                  onClick={() => setExtras((rows) => rows.filter((x) => x.key !== r.key))}
                />
              </>
            }
          />
        ))}
        <Row
          tone="link"
          left={<Icon name="plus" size={20} stroke={2.2} />}
          title={t('receipt.addExtra')}
          onClick={() => setExtras((rows) => [...rows, { key: nextKey(), kind: 'service', label: '', amount: '' }])}
        />
      </Section>

      <Section title={t('receipt.totalTitle')} footer={t('receipt.printedHint')}>
        <Row
          title={t('receipt.sumLabel')}
          right={
            <span className="receipt-sum">
              <Money value={totals.sum} currency={cur} />
            </span>
          }
        />
        <Row
          title={t('receipt.printedLabel')}
          right={
            <MoneyBox
              currency={cur}
              placeholder={t('receipt.printedPlaceholder')}
              aria-label={t('receipt.printedLabel')}
              invalid={printedBad}
              value={printed}
              onChange={(e) => setPrinted(e.target.value)}
            />
          }
        />
        {printedValue !== null && !mismatch && (
          <div className="row receipt-check" role="status">
            <OkLine>{t('receipt.matches')}</OkLine>
          </div>
        )}
        {mismatch && printedValue !== null && (
          <>
            <Row
              className="receipt-check neg"
              left={<Icon name="info" size={20} />}
              title={t('receipt.mismatch', {
                printed: money(printedValue),
                sum: money(totals.sum),
                diff: money(totals.diff ?? 0),
              })}
              wrap
            />
            <div className="receipt-fix">
              <Button variant="tint" wide onClick={() => setPrinted('')}>
                {t('receipt.acceptSum')}
              </Button>
              <Button
                variant="fill"
                wide
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
              </Button>
            </div>
          </>
        )}
      </Section>

      <MainButton text={t('receipt.next')} onClick={next} disabled={!valid} />
    </>
  );
}
