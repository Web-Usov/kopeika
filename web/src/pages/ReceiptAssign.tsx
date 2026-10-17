// "Who ate what": pick members for every receipt line, see live totals, create an `exact` expense.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CATEGORIES,
  type CategoryId,
  categoryKey,
  DEFAULT_CATEGORY,
  suggestCategory,
} from '../../../shared/categories.ts';
import {
  computeShares,
  convertAmount,
  convertExactShares,
  formatMoney,
  normalizeRate,
  type SplitInput,
} from '../../../shared/money.ts';
import {
  type AdjustmentMode,
  type AssignItem,
  assignShares,
  assignTotal,
  splitIntoUnits,
  wholeQuantity,
} from '../../../shared/receiptAssign.ts';
import type { ReceiptDraft } from '../../../shared/receiptDraft.ts';
import { api, type GroupDetail } from '../api.ts';
import { applySavedGroup } from '../celebration.ts';
import { errorText, lang, t } from '../i18n.ts';
import { setReceiptDraft } from '../receiptDraft.ts';
import { navigate } from '../router.ts';
import { alertDialog, haptic, MainButton } from '../tg.tsx';
import { Avatar, Money, Row, Section, Segmented, todayIso } from '../ui.tsx';
import { rateDay, showRate } from './ExpenseForm.tsx';

type RateInfo = { status: 'idle' | 'loading' | 'ok' | 'error'; date?: string; error?: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function ReceiptAssign({ g, draft, onBack }: { g: GroupDetail; draft: ReceiptDraft; onBack: () => void }) {
  const today = todayIso();
  const [items, setItems] = useState<AssignItem[]>(() =>
    draft.items.map((i) => ({ id: i.id, name: i.name, amount: i.amount, memberIds: [] })),
  );
  const quantities = useMemo(() => new Map(draft.items.map((i) => [i.id, i.quantity])), [draft.items]);
  const [modes, setModes] = useState<Record<string, AdjustmentMode>>({});
  const [payerId, setPayerId] = useState(g.meId);
  const [spentOn, setSpentOn] = useState(ISO_DATE.test(draft.date) && draft.date <= today ? draft.date : today);
  const [title, setTitle] = useState(draft.merchant || t('receipt.title'));
  const [category, setCategory] = useState<CategoryId>(
    () =>
      suggestCategory(draft.merchant, lang) ?? (CATEGORIES.some((c) => c.id === 'food') ? 'food' : DEFAULT_CATEGORY),
  );
  const [categoryPicked, setCategoryPicked] = useState(false);
  const [saving, setSaving] = useState(false);

  const currency = draft.currency;
  const foreign = currency !== g.currency;
  const [rateStr, setRateStr] = useState('');
  const [rateManual, setRateManual] = useState(false);
  const [rateInfo, setRateInfo] = useState<RateInfo>({ status: 'idle' });

  // Suggested rate for the date; a rate typed by hand is never overwritten (same as in the expense form).
  useEffect(() => {
    if (!foreign || rateManual) return;
    let cancelled = false;
    setRateInfo({ status: 'loading' });
    api
      .rate(g.currency, currency, spentOn)
      .then((r) => {
        if (cancelled) return;
        setRateStr(showRate(r.rate));
        setRateInfo({ status: 'ok', date: r.date });
      })
      .catch((e: Error) => {
        if (!cancelled) setRateInfo({ status: 'error', error: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [foreign, rateManual, g.currency, currency, spentOn]);

  const toggle = (itemId: string, memberId: number) => {
    haptic.tap();
    setItems((rows) =>
      rows.map((r) =>
        r.id !== itemId
          ? r
          : {
              ...r,
              memberIds: r.memberIds.includes(memberId)
                ? r.memberIds.filter((m) => m !== memberId)
                : [...r.memberIds, memberId],
            },
      ),
    );
  };
  const allIds = g.members.map((m) => m.id);
  const setAll = (itemId: string, on: boolean) =>
    setItems((rows) => rows.map((r) => (r.id === itemId ? { ...r, memberIds: on ? allIds : [] } : r)));
  const splitAllEqual = (onlyEmpty: boolean) => {
    haptic.tap();
    setItems((rows) => rows.map((r) => (onlyEmpty && r.memberIds.length > 0 ? r : { ...r, memberIds: allIds })));
  };
  const splitUnits = (itemId: string, n: number) => {
    haptic.tap();
    setItems((rows) => rows.flatMap((r) => (r.id === itemId ? splitIntoUnits(r, n) : [r])));
  };

  const unassigned = items.filter((i) => i.memberIds.length === 0);
  const total = assignTotal(items, draft.adjustments);

  let shares: Map<number, number> | null = null;
  let shareError: string | null = null;
  if (unassigned.length === 0) {
    try {
      shares = assignShares(items, draft.adjustments, modes);
    } catch (e) {
      shareError = errorText(e);
    }
  }

  const rate = foreign ? normalizeRate(rateStr) : null;
  const converted = useMemo(() => {
    if (!foreign || !rate || total <= 0) return null;
    try {
      return convertAmount(total, rate, currency, g.currency);
    } catch {
      return null;
    }
  }, [foreign, rate, total, currency, g.currency]);

  const inputs: SplitInput[] = shares
    ? [...shares].filter(([, v]) => v > 0).map(([memberId, value]) => ({ memberId, value }))
    : [];
  // What lands in the balances, in the group currency.
  const groupShares = useMemo(() => {
    if (!shares || total <= 0) return null;
    if (!foreign) return shares;
    if (!rate || converted === null) return null;
    try {
      const conv = convertExactShares(inputs, rate, currency, g.currency);
      computeShares(converted, 'exact', conv);
      return new Map(conv.map((i) => [i.memberId, i.value]));
    } catch {
      return null;
    }
  }, [shares, total, foreign, rate, converted, currency, g.currency]);

  const valid = Boolean(title.trim() && shares && total > 0 && (!foreign || (rate && converted)));

  const create = async () => {
    if (!shares || !valid) return;
    setSaving(true);
    try {
      const saved = await api.addExpense(g.id, {
        title: title.trim(),
        amount: converted ?? total,
        ...(foreign && rate ? { originalAmount: total, originalCurrency: currency, rate } : {}),
        payerId,
        splitMode: 'exact',
        spentOn,
        category,
        shares: inputs,
      });
      setReceiptDraft(g.id, null);
      applySavedGroup(saved);
      haptic.success();
      navigate(`/g/${g.id}`, { replace: true });
    } catch (e) {
      setSaving(false);
      haptic.error();
      await alertDialog((e as Error).message);
    }
  };

  const chipsRef = useRef<HTMLDivElement>(null);
  const nameOf = (id: number) => {
    const m = g.members.find((x) => x.id === id);
    return m ? (m.id === g.meId ? t('common.youParen', { name: m.name }) : m.name) : '';
  };
  const money = (v: number, cur = currency) => formatMoney(v, cur, lang);
  const hasMulti = draft.adjustments.some((a) => a.amount !== 0);

  return (
    <>
      <h2 className="page-title">{t('receipt.assignTitle')}</h2>
      <p className="hint page-subtitle">{t('receipt.assignHint')}</p>

      <Section
        title={
          <span className="section-title-row">
            {t('receipt.itemsTitle')}
            <button type="button" className="text-btn small" onClick={() => splitAllEqual(false)}>
              {t('receipt.splitAllEqual')}
            </button>
          </span>
        }
        footer={
          unassigned.length > 0 ? (
            <span className="neg" role="status">
              {t('receipt.unassigned', { names: unassigned.map((i) => i.name).join(', ') })}{' '}
              <button type="button" className="text-btn small" onClick={() => splitAllEqual(true)}>
                {t('receipt.unassignedFix')}
              </button>
            </span>
          ) : undefined
        }
      >
        {items.map((it) => {
          const everyone = it.memberIds.length === g.members.length;
          const units = wholeQuantity(quantities.get(it.id));
          return (
            <div className={`row assign-item ${it.memberIds.length === 0 ? 'unassigned' : ''}`} key={it.id}>
              <div className="assign-head">
                <span className="row-title">{it.name}</span>
                <span className="assign-amount">
                  <Money value={it.amount} currency={currency} />
                </span>
              </div>
              <div className="chips wrap">
                <button
                  type="button"
                  className={`chip ${everyone ? 'active' : ''}`}
                  aria-pressed={everyone}
                  onClick={() => {
                    haptic.tap();
                    setAll(it.id, !everyone);
                  }}
                >
                  {t('receipt.everyone')}
                </button>
                {g.members.map((m) => {
                  const on = it.memberIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`chip ${on ? 'active' : ''}`}
                      aria-pressed={on}
                      onClick={() => toggle(it.id, m.id)}
                    >
                      {m.name}
                    </button>
                  );
                })}
                {units !== null && (
                  <button type="button" className="chip dashed" onClick={() => splitUnits(it.id, units)}>
                    {t('receipt.splitUnits', { count: units })}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </Section>

      {hasMulti && (
        <Section title={t('receipt.extrasTitle')} footer={t('receipt.extrasHow')}>
          {draft.adjustments
            .filter((a) => a.amount !== 0)
            .map((a) => (
              <div className="row assign-item" key={a.id}>
                <div className="assign-head">
                  <span className="row-title">
                    {t(`receipt.kind.${a.kind}`)}
                    {a.label && <span className="hint small"> {a.label}</span>}
                  </span>
                  <span className={`assign-amount ${a.amount < 0 ? 'pos' : ''}`}>
                    {a.amount < 0 ? '−' : '+'}
                    {money(Math.abs(a.amount))}
                  </span>
                </div>
                <Segmented<AdjustmentMode>
                  value={modes[a.id] ?? 'proportional'}
                  onChange={(m) => {
                    haptic.tap();
                    setModes((cur) => ({ ...cur, [a.id]: m }));
                  }}
                  options={[
                    { value: 'proportional', label: t('receipt.modeProportional') },
                    { value: 'equal', label: t('receipt.modeEqual') },
                  ]}
                />
              </div>
            ))}
        </Section>
      )}

      <Section
        title={t('receipt.peopleTitle')}
        footer={
          shareError ? (
            <span className="neg">{shareError}</span>
          ) : foreign && !rate ? undefined : (
            t('receipt.peopleSum', { amount: money(total) })
          )
        }
      >
        {g.members.map((m) => {
          const v = shares?.get(m.id);
          const gv = groupShares?.get(m.id);
          return (
            <Row
              key={m.id}
              left={<Avatar member={m} size={32} />}
              title={nameOf(m.id)}
              subtitle={foreign && gv ? t('receipt.approx', { amount: formatMoney(gv, g.currency, lang) }) : undefined}
              right={v ? <Money value={v} currency={currency} /> : <span className="hint">—</span>}
            />
          );
        })}
      </Section>

      <Section>
        <input
          className="field"
          placeholder={t('expense.titlePlaceholder')}
          aria-label={t('expense.titlePlaceholder')}
          value={title}
          maxLength={100}
          onChange={(e) => {
            setTitle(e.target.value);
            if (!categoryPicked) setCategory(suggestCategory(e.target.value, lang) ?? DEFAULT_CATEGORY);
          }}
        />
        {foreign && (
          <>
            <div className="amount-field rate-field">
              <span className="rate-label">{t('expense.rateLabel')}</span>
              <input
                className="field rate"
                inputMode="decimal"
                aria-label={t('expense.rateLabel')}
                placeholder={rateInfo.status === 'error' ? t('expense.rateEnter') : t('expense.ratePlaceholder')}
                value={rateStr}
                onChange={(e) => {
                  setRateStr(e.target.value);
                  setRateManual(true);
                }}
              />
              <span className="currency">
                {g.currency}/{currency}
              </span>
            </div>
            {rateStr.trim() && !rate ? (
              <div className="field-error">{t('expense.rateError')}</div>
            ) : (
              <div className="rate-hint hint">
                {rateInfo.status === 'loading' && t('expense.rateLoading')}
                {rateInfo.status === 'error' && !rate && rateInfo.error}
                {rate &&
                  converted &&
                  t(rateInfo.status === 'ok' && !rateManual ? 'expense.rateApprox' : 'expense.rateApproxManual', {
                    amount: formatMoney(converted, g.currency, lang),
                    rate: showRate(rate),
                    date: rateDay(rateInfo.date ?? spentOn),
                  })}
              </div>
            )}
            <div className="rate-hint hint">{t('expense.exactForeignHint', { currency })}</div>
          </>
        )}
        <div className="chips-caption">{t('expense.categorySection')}</div>
        <div className="chips" ref={chipsRef}>
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`chip ${category === c.id ? 'active' : ''}`}
              aria-pressed={category === c.id}
              onClick={() => {
                haptic.tap();
                setCategory(c.id);
                setCategoryPicked(true);
              }}
            >
              <span aria-hidden="true">{c.emoji}</span>
              {t(categoryKey(c.id))}
            </button>
          ))}
        </div>
      </Section>

      <Section title={t('expense.whoPaid')}>
        <select
          className="field"
          aria-label={t('expense.whoPaid')}
          value={payerId}
          onChange={(e) => setPayerId(Number(e.target.value))}
        >
          {g.members.map((m) => (
            <option key={m.id} value={m.id}>
              {nameOf(m.id)}
            </option>
          ))}
        </select>
      </Section>

      <Section title={t('expense.when')}>
        <input
          className="field"
          type="date"
          aria-label={t('expense.when')}
          value={spentOn}
          max={today}
          onChange={(e) => setSpentOn(e.target.value || today)}
        />
      </Section>

      <button type="button" className="text-btn" onClick={onBack}>
        {t('receipt.nextBack')}
      </button>

      <MainButton text={t('receipt.create')} onClick={() => void create()} disabled={!valid} loading={saving} />
    </>
  );
}
