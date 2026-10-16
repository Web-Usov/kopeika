import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CATEGORIES,
  type CategoryId,
  categoryKey,
  DEFAULT_CATEGORY,
  suggestCategory,
} from '../../../shared/categories.ts';
import {
  amountToInput,
  CURRENCIES,
  computeShares,
  convertAmount,
  convertExactShares,
  formatMoney,
  normalizeRate,
  parseAmount,
  type SplitInput,
  type SplitMode,
} from '../../../shared/money.ts';
import { addDays, isoWeekday, nextOccurrence, type Period } from '../../../shared/recurring.ts';
import { api, type Expense, type GroupDetail, useExpense, useGroup } from '../api.ts';
import { applySavedGroup } from '../celebration.ts';
import { dateLocale, errorText, lang, rich, t } from '../i18n.ts';
import { setReceiptDraft } from '../receiptDraft.ts';
import { scheduleText, shortDate } from '../recurring.ts';
import { navigate } from '../router.ts';
import { alertDialog, BackButton, confirmDialog, haptic, MainButton } from '../tg.tsx';
import { Avatar, ErrorView, Loading, Money, Row, Section, Segmented, todayIso } from '../ui.tsx';

export function ExpenseForm({ groupId, expenseId }: { groupId: number; expenseId?: number }) {
  const { data: g, error } = useGroup(groupId);
  const { expense: found, loading } = useExpense(groupId, expenseId, g);
  const back = <BackButton onClick={() => navigate(`/g/${groupId}`, { replace: true })} />;
  if (!g || loading)
    return (
      <div className="page">
        {back}
        {error ? <ErrorView message={error} /> : <Loading />}
      </div>
    );

  const expense = found?.kind === 'expense' ? found : undefined;
  if (expenseId && !expense)
    return (
      <div className="page">
        {back}
        <ErrorView message={t('expense.notFound')} />
      </div>
    );
  return (
    <div className="page">
      {back}
      <Editor g={g} expense={expense} />
    </div>
  );
}

interface Participant {
  on: boolean; // equal
  weight: number; // shares
  exact: string; // exact, as typed
}

function initialParticipants(g: GroupDetail, e?: Expense): Record<number, Participant> {
  const out: Record<number, Participant> = {};
  for (const m of g.members) {
    const s = e?.shares.find((x) => x.memberId === m.id);
    out[m.id] = {
      on: e ? Boolean(s) : true,
      weight: e?.splitMode === 'shares' ? (s?.input ?? 0) : 1,
      exact: e?.splitMode === 'exact' && s ? amountToInput(s.input) : '',
    };
  }
  return out;
}

/** "12 октября" (with the year if it is not the current one) for the rate caption. */
function rateDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(dateLocale, {
    day: 'numeric',
    month: 'long',
    ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  }).format(new Date(y, m - 1, d));
}

/** Rate for the input and the caption: a decimal comma in Russian. */
const showRate = (rate: string) => (lang === 'ru' ? rate.replace('.', ',') : rate);

type RateInfo = { status: 'idle' | 'loading' | 'ok' | 'error'; date?: string; error?: string };

/** «Разобрать чек» for a new expense: only when the feature is on; shows what is left of the trial quota. */
function ReceiptEntry({ g }: { g: GroupDetail }) {
  // Servers with quotas (#102) say it per group; older ones only in /me.
  const [enabled, setEnabled] = useState<boolean | undefined>(g.receipts?.enabled);
  useEffect(() => {
    if (g.receipts) return setEnabled(g.receipts.enabled);
    api.me().then(
      (me) => setEnabled(Boolean(me.receiptsEnabled)),
      () => setEnabled(false),
    );
  }, [g.receipts]);
  if (!enabled) return null;

  const q = g.receipts;
  const limited = Boolean(q && !q.unlimited && q.limit > 0);
  const left = q ? Math.max(0, q.limit - q.used) : 0;
  const exhausted = limited && left === 0;
  const reset = q?.resetsAt ? shortDate(q.resetsAt.slice(0, 10)) : '';
  return (
    <Section
      footer={
        exhausted
          ? reset
            ? t('receipt.buttonLimitReset', { date: reset })
            : t('receipt.buttonLimit')
          : limited && q
            ? t('receipt.buttonLeft', { left, limit: q.limit })
            : undefined
      }
    >
      <Row
        className="link"
        title={t('receipt.button')}
        onClick={
          exhausted
            ? undefined
            : () => {
                setReceiptDraft(g.id, null);
                navigate(`/g/${g.id}/receipt`);
              }
        }
      />
    </Section>
  );
}

function Editor({ g, expense }: { g: GroupDetail; expense?: Expense }) {
  const [title, setTitle] = useState(expense?.title ?? '');
  const [currency, setCurrency] = useState(expense?.originalCurrency ?? g.currency);
  const foreign = currency !== g.currency;
  // An existing foreign expense keeps its saved rate until the currency changes.
  const [rateStr, setRateStr] = useState(expense?.rate ? showRate(expense.rate) : '');
  const [rateManual, setRateManual] = useState(Boolean(expense?.rate));
  const [rateInfo, setRateInfo] = useState<RateInfo>({ status: 'idle' });
  const [amountStr, setAmountStr] = useState(expense ? amountToInput(expense.originalAmount ?? expense.amount) : '');
  const [payerId, setPayerId] = useState(expense?.payerId ?? g.meId);
  const [spentOn, setSpentOn] = useState(expense?.spentOn ?? todayIso());
  const [mode, setMode] = useState<SplitMode>(expense?.splitMode ?? 'equal');
  const [parts, setParts] = useState(() => initialParticipants(g, expense));
  const [category, setCategory] = useState<CategoryId>(expense?.category ?? DEFAULT_CATEGORY);
  // Until the user picks a category by hand, it follows the title; an existing expense keeps its own.
  const [categoryPicked, setCategoryPicked] = useState(Boolean(expense));
  const [saving, setSaving] = useState(false);
  // New expenses only: also create a recurring template (same day of month / weekday as the expense date).
  const [repeat, setRepeat] = useState<Period | 'none'>('none');

  const chipsRef = useRef<HTMLDivElement>(null);
  // Keep the selected chip visible in the scrollable row. A new expense starts at the beginning of the row.
  const firstRun = useRef(true);
  useEffect(() => {
    const row = chipsRef.current;
    const first = firstRun.current;
    firstRun.current = false;
    if (!row || (first && !expense)) return;
    const chip = row.querySelector<HTMLElement>('.chip.active');
    if (!chip) return;
    const pad = 16;
    const rowRect = row.getBoundingClientRect();
    const chipRect = chip.getBoundingClientRect();
    const start = chipRect.left - rowRect.left + row.scrollLeft;
    const end = start + chipRect.width;
    let left = row.scrollLeft;
    if (start - pad < left) left = start - pad;
    else if (end + pad > left + row.clientWidth) left = end + pad - row.clientWidth;
    if (left !== row.scrollLeft) row.scrollTo({ left, behavior: first ? 'auto' : 'smooth' });
  }, [category]);

  // Suggested rate for the expense date; a rate typed by hand is never overwritten.
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

  const amount = parseAmount(amountStr);
  const rate = foreign ? normalizeRate(rateStr) : null;
  const update = (id: number, patch: Partial<Participant>) => setParts((p) => ({ ...p, [id]: { ...p[id], ...patch } }));

  const inputs: SplitInput[] = useMemo(() => {
    return g.members.flatMap((m): SplitInput[] => {
      const p = parts[m.id];
      if (mode === 'equal') return p.on ? [{ memberId: m.id, value: 1 }] : [];
      if (mode === 'shares') return p.weight > 0 ? [{ memberId: m.id, value: p.weight }] : [];
      const v = parseAmount(p.exact);
      return v ? [{ memberId: m.id, value: v }] : [];
    });
  }, [g.members, parts, mode]);

  const exactSum = mode === 'exact' ? inputs.reduce((a, i) => a + i.value, 0) : 0;
  const exactBadInput =
    mode === 'exact' && g.members.some((m) => parts[m.id].exact.trim() && parseAmount(parts[m.id].exact) === null);

  let computed: Map<number, number> | null = null;
  let splitError: string | null = null;
  // The total in the group currency (what lands in the balances).
  let converted: number | null = foreign ? null : amount;
  if (amount && (!foreign || rate)) {
    try {
      if (!foreign || !rate) computed = computeShares(amount, mode, inputs);
      else {
        converted = convertAmount(amount, rate, currency, g.currency);
        if (mode === 'exact') {
          computeShares(amount, 'exact', inputs); // adds up in the entered currency
          computed = computeShares(converted, 'exact', convertExactShares(inputs, rate, currency, g.currency));
        } else computed = computeShares(converted, mode, inputs);
      }
    } catch (e) {
      splitError = errorText(e);
    }
  }
  const valid = Boolean(title.trim() && amount && computed && !exactBadInput);

  const save = async () => {
    if (!amount || !computed) return;
    setSaving(true);
    const body = {
      title: title.trim(),
      amount: converted ?? amount,
      ...(foreign && rate ? { originalAmount: amount, originalCurrency: currency, rate } : {}),
      payerId,
      splitMode: mode,
      spentOn,
      category,
      shares: inputs,
    };
    try {
      const saved = expense ? await api.updateExpense(g.id, expense.id, body) : await api.addExpense(g.id, body);
      if (!expense && repeat !== 'none' && !foreign) {
        try {
          // The expense above is the first one; the template takes over from tomorrow.
          await api.addRecurring(g.id, {
            title: body.title,
            amount: body.amount,
            payerId,
            splitMode: mode,
            category,
            shares: inputs,
            period: repeat,
            day: repeatDay,
            startDate: addDays(todayIso(), 1),
          });
        } catch (e) {
          haptic.error();
          await alertDialog((e as Error).message);
        }
      }
      applySavedGroup(saved);
      haptic.success();
      navigate(`/g/${g.id}`, { replace: true });
    } catch (e) {
      setSaving(false);
      haptic.error();
      await alertDialog((e as Error).message);
    }
  };

  const remove = async () => {
    if (!expense || !(await confirmDialog(t('expense.confirmDelete', { title: expense.title })))) return;
    try {
      applySavedGroup(await api.deleteExpense(g.id, expense.id));
      navigate(`/g/${g.id}`, { replace: true });
    } catch (e) {
      await alertDialog((e as Error).message);
    }
  };

  const repeatDay = repeat === 'weekly' ? isoWeekday(spentOn) : Number(spentOn.slice(8, 10));
  const repeatNext = repeat === 'none' ? null : nextOccurrence(repeat, repeatDay, todayIso());

  const allOn = g.members.every((m) => parts[m.id].on);

  return (
    <>
      <h2 className="page-title">{expense ? t('expense.titleEdit') : t('expense.titleNew')}</h2>

      {!expense && <ReceiptEntry g={g} />}

      <Section>
        <input
          className="field"
          placeholder={t('expense.titlePlaceholder')}
          value={title}
          maxLength={100}
          onChange={(e) => {
            setTitle(e.target.value);
            if (!categoryPicked) setCategory(suggestCategory(e.target.value, lang) ?? DEFAULT_CATEGORY);
          }}
        />
        <div className="amount-field">
          <input
            className="field amount"
            inputMode="decimal"
            placeholder="0"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
          />
          <select
            className="currency-select"
            aria-label={t('expense.currencyLabel')}
            value={currency}
            onChange={(e) => {
              setCurrency(e.target.value);
              setRateManual(false);
              setRateStr('');
              setRateInfo({ status: 'idle' });
            }}
          >
            {[g.currency, ...CURRENCIES.filter((c) => c !== g.currency)].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        {amountStr && amount === null && <div className="field-error">{t('expense.amountError')}</div>}
        {foreign && (
          <>
            <div className="amount-field rate-field">
              <span className="rate-label">{t('expense.rateLabel')}</span>
              <input
                className="field rate"
                inputMode="decimal"
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
            {mode === 'exact' && <div className="rate-hint hint">{t('expense.exactForeignHint', { currency })}</div>}
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
        <select className="field" value={payerId} onChange={(e) => setPayerId(Number(e.target.value))}>
          {g.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id === g.meId ? t('common.youParen', { name: m.name }) : m.name}
            </option>
          ))}
        </select>
      </Section>

      <Section title={t('expense.when')}>
        <input
          className="field"
          type="date"
          value={spentOn}
          max={todayIso()}
          onChange={(e) => setSpentOn(e.target.value || todayIso())}
        />
      </Section>

      <Section
        title={
          <span className="section-title-row">
            {t('expense.splitWith')}
            {mode === 'equal' && (
              <button
                type="button"
                className="text-btn small"
                onClick={() =>
                  setParts((p) => Object.fromEntries(g.members.map((m) => [m.id, { ...p[m.id], on: !allOn }])))
                }
              >
                {allOn ? t('expense.deselectAll') : t('expense.selectAll')}
              </button>
            )}
          </span>
        }
        footer={
          mode === 'exact' && amount ? (
            exactSum === amount ? (
              <span className="pos">{t('expense.exactDone')}</span>
            ) : exactSum < amount ? (
              rich('expense.exactLeft', { amount: <Money value={amount - exactSum} currency={currency} /> })
            ) : (
              <span className="neg">
                {rich('expense.exactOver', { amount: <Money value={exactSum - amount} currency={currency} /> })}
              </span>
            )
          ) : splitError && amount ? (
            <span className="neg">{splitError}</span>
          ) : mode === 'shares' ? (
            t('expense.sharesHint')
          ) : undefined
        }
      >
        <Segmented<SplitMode>
          value={mode}
          onChange={(m) => {
            haptic.tap();
            setMode(m);
          }}
          options={[
            { value: 'equal', label: t('expense.modeEqual') },
            { value: 'shares', label: t('expense.modeShares') },
            { value: 'exact', label: t('expense.modeExact') },
          ]}
        />
        {g.members.map((m) => {
          const p = parts[m.id];
          const share = computed?.get(m.id);
          const shareView = share ? <Money value={share} currency={g.currency} /> : <span className="hint">—</span>;
          const name = m.id === g.meId ? t('common.youParen', { name: m.name }) : m.name;

          if (mode === 'equal') {
            return (
              <Row
                key={m.id}
                onClick={() => {
                  haptic.tap();
                  update(m.id, { on: !p.on });
                }}
                left={<span className={`check ${p.on ? 'on' : ''}`} />}
                title={name}
                right={p.on ? shareView : <span className="hint">—</span>}
              />
            );
          }
          if (mode === 'shares') {
            return (
              <Row
                key={m.id}
                left={<Avatar member={m} size={32} />}
                title={name}
                subtitle={shareView}
                right={
                  <span className="stepper">
                    <button
                      type="button"
                      onClick={() => update(m.id, { weight: Math.max(0, p.weight - 1) })}
                      disabled={p.weight === 0}
                    >
                      −
                    </button>
                    <span>{p.weight}</span>
                    <button type="button" onClick={() => update(m.id, { weight: Math.min(99, p.weight + 1) })}>
                      +
                    </button>
                  </span>
                }
              />
            );
          }
          return (
            <Row
              key={m.id}
              left={<Avatar member={m} size={32} />}
              title={name}
              right={
                <input
                  className={`field exact ${p.exact.trim() && parseAmount(p.exact) === null ? 'invalid' : ''}`}
                  inputMode="decimal"
                  placeholder="0"
                  value={p.exact}
                  onChange={(e) => update(m.id, { exact: e.target.value })}
                />
              }
            />
          );
        })}
      </Section>

      {!expense && (
        <Section
          title={t('recurring.repeat')}
          footer={
            foreign
              ? t('recurring.foreignHint')
              : repeatNext
                ? `${t('recurring.hint', { date: shortDate(repeatNext) })}${repeat === 'monthly' && repeatDay >= 29 ? ` ${t('recurring.shortMonthHint')}` : ''}`
                : undefined
          }
        >
          <Segmented<Period | 'none'>
            value={foreign ? 'none' : repeat}
            onChange={(r) => {
              if (foreign) return;
              haptic.tap();
              setRepeat(r);
            }}
            options={[
              { value: 'none', label: t('recurring.none') },
              { value: 'monthly', label: t('recurring.monthly') },
              { value: 'weekly', label: t('recurring.weekly') },
            ]}
          />
          {!foreign && repeat !== 'none' && <div className="row hint">{scheduleText(repeat, repeatDay)}</div>}
        </Section>
      )}

      {expense && (
        <button type="button" className="danger-btn" onClick={remove}>
          {t('expense.delete')}
        </button>
      )}

      <MainButton
        text={expense ? t('expense.save') : t('expense.add')}
        onClick={save}
        disabled={!valid}
        loading={saving}
      />
    </>
  );
}
