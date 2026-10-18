import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  CATEGORIES,
  type CategoryId,
  categoryIcon,
  categoryKey,
  categoryTone,
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
import { Icon } from '../icons.tsx';
import { clearQuickDraft, peekQuickDraft } from '../quickDraft.ts';
import { setReceiptDraft } from '../receiptDraft.ts';
import { scheduleText, shortDate } from '../recurring.ts';
import { navigate } from '../router.ts';
import { alertDialog, BackButton, confirmDialog, haptic, MainButton } from '../tg.tsx';
import {
  AmountAction,
  AmountCard,
  Avatar,
  Box,
  Button,
  Check,
  Chip,
  Chips,
  ErrorView,
  FieldRow,
  formatDay,
  Loading,
  Money,
  OkLine,
  PickRow,
  Row,
  Screen,
  ScreenTitle,
  Section,
  Segmented,
  Stepper,
  todayIso,
} from '../ui.tsx';

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
    <Screen>
      {back}
      <Editor g={g} expense={expense} />
    </Screen>
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
export function rateDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(dateLocale, {
    day: 'numeric',
    month: 'long',
    ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  }).format(new Date(y, m - 1, d));
}

/** Rate for the input and the caption: a decimal comma in Russian. */
export const showRate = (rate: string) => (lang === 'ru' ? rate.replace('.', ',') : rate);

type RateInfo = { status: 'idle' | 'loading' | 'ok' | 'error'; date?: string; error?: string };

/** «Разобрать чек» строкой в карточке суммы (new expense): only when the feature is on; shows what is left of the trial quota. */
function ReceiptEntry({ g }: { g: GroupDetail }) {
  // Servers with quotas (#102) say it per group; older ones only in /me.
  const shown = (r: NonNullable<GroupDetail['receipts']>) => r.offered ?? r.enabled;
  const [enabled, setEnabled] = useState<boolean | undefined>(g.receipts && shown(g.receipts));
  useEffect(() => {
    if (g.receipts) return setEnabled(shown(g.receipts));
    api.me().then(
      (me) => setEnabled(Boolean(me.receiptsEnabled)),
      () => setEnabled(false),
    );
  }, [g.receipts]);
  if (!enabled) return null;

  const q = g.receipts;
  // In the beta a group without approval has no quota to show yet.
  const approved = !q?.beta || q.access === 'approved';
  const limited = Boolean(q && approved && !q.unlimited && q.limit > 0);
  const left = q ? Math.max(0, q.limit - q.used) : 0;
  const exhausted = limited && left === 0;
  const reset = q?.resetsAt ? shortDate(q.resetsAt.slice(0, 10)) : '';
  return (
    <AmountAction
      icon="camera"
      disabled={exhausted}
      caption={
        exhausted
          ? reset
            ? t('expense.scanLimitReset', { date: reset })
            : t('expense.scanLimit')
          : limited && q
            ? t('expense.scanLeft', { left, limit: q.limit })
            : undefined
      }
      onClick={() => {
        setReceiptDraft(g.id, null);
        navigate(`/g/${g.id}/receipt`);
      }}
    >
      {t(q?.beta ? 'expense.scanBeta' : 'expense.scan')}
    </AmountAction>
  );
}

function Editor({ g, expense }: { g: GroupDetail; expense?: Expense }) {
  // «Быстрая трата» hands over what it parsed; only a new expense takes it.
  const [quick] = useState(() => (expense ? undefined : peekQuickDraft(g.id)));
  useEffect(() => clearQuickDraft(), []);
  const [title, setTitle] = useState(expense?.title ?? quick?.title ?? '');
  const [currency, setCurrency] = useState(expense?.originalCurrency ?? quick?.currency ?? g.currency);
  const foreign = currency !== g.currency;
  // An existing foreign expense keeps its saved rate until the currency changes.
  const [rateStr, setRateStr] = useState(expense?.rate ? showRate(expense.rate) : '');
  const [rateManual, setRateManual] = useState(Boolean(expense?.rate));
  const [rateInfo, setRateInfo] = useState<RateInfo>({ status: 'idle' });
  const [amountStr, setAmountStr] = useState(
    expense ? amountToInput(expense.originalAmount ?? expense.amount) : quick ? amountToInput(quick.amount) : '',
  );
  const [payerId, setPayerId] = useState(expense?.payerId ?? g.meId);
  const [spentOn, setSpentOn] = useState(expense?.spentOn ?? todayIso());
  const [mode, setMode] = useState<SplitMode>(expense?.splitMode ?? 'equal');
  const [parts, setParts] = useState(() => initialParticipants(g, expense));
  const [category, setCategory] = useState<CategoryId>(expense?.category ?? quick?.category ?? DEFAULT_CATEGORY);
  // Until the user picks a category by hand, it follows the title; an existing expense keeps its own.
  const [categoryPicked, setCategoryPicked] = useState(Boolean(expense || quick));
  const [saving, setSaving] = useState(false);
  // New expenses only: also create a recurring template (same day of month / weekday as the expense date).
  const [repeat, setRepeat] = useState<Period | 'none'>('none');

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

  const payer = g.members.find((m) => m.id === payerId) ?? g.members[0];
  const nameOf = (m: { id: number; name: string }) =>
    m.id === g.meId ? t('common.youParen', { name: m.name }) : m.name;
  const repeatLabel: Record<Period | 'none', string> = {
    none: t('recurring.none'),
    monthly: t('recurring.monthly'),
    weekly: t('recurring.weekly'),
  };
  const shownRepeat = foreign ? 'none' : repeat;
  const categoryAuto = !categoryPicked && Boolean(suggestCategory(title, lang));

  // Under the split: the total "По 800 ₽ на 4 человека — сходится до копейки" or the old messages about a mismatch.
  let splitFooter: ReactNode;
  if (mode === 'exact' && amount) {
    if (exactSum === amount) splitFooter = <OkLine>{t('expense.exactDone')}</OkLine>;
    else if (exactSum < amount)
      splitFooter = rich('expense.exactLeft', { amount: <Money value={amount - exactSum} currency={currency} /> });
    else
      splitFooter = (
        <span className="neg">
          {rich('expense.exactOver', { amount: <Money value={exactSum - amount} currency={currency} /> })}
        </span>
      );
  } else if (splitError && amount) splitFooter = <span className="neg">{splitError}</span>;
  else if (mode === 'shares') splitFooter = t('expense.sharesHint');
  else if (mode === 'equal' && computed && converted && computed.size > 1) {
    const values = [...computed.values()];
    const even = values.every((v) => v === values[0]);
    splitFooter = (
      <OkLine>
        {t(even ? 'expense.okEven' : 'expense.okUneven', {
          amount: formatMoney(even ? values[0] : converted, g.currency, lang),
          count: computed.size,
        })}
      </OkLine>
    );
  }

  return (
    <>
      <ScreenTitle>{expense ? t('expense.titleEdit') : t('expense.titleNew')}</ScreenTitle>

      <AmountCard
        label={t('expense.amountLabel')}
        value={amountStr}
        onChange={setAmountStr}
        error={amountStr && amount === null ? t('expense.amountError') : undefined}
        currency={{
          value: currency,
          options: [g.currency, ...CURRENCIES.filter((c) => c !== g.currency)],
          label: t('expense.currencyLabel'),
          onChange: (c) => {
            setCurrency(c);
            setRateManual(false);
            setRateStr('');
            setRateInfo({ status: 'idle' });
          },
        }}
        title={{
          placeholder: t('expense.titlePlaceholder'),
          value: title,
          maxLength: 100,
          'aria-label': t('expense.titlePlaceholder'),
          onChange: (e) => {
            setTitle(e.target.value);
            if (!categoryPicked) setCategory(suggestCategory(e.target.value, lang) ?? DEFAULT_CATEGORY);
          },
        }}
      >
        {foreign && (
          <>
            <FieldRow
              label={t('expense.rateLabel')}
              inputMode="decimal"
              placeholder={rateInfo.status === 'error' ? t('expense.rateEnter') : t('expense.ratePlaceholder')}
              value={rateStr}
              error={rateStr.trim() && !rate ? t('expense.rateError') : undefined}
              suffix={`${g.currency}/${currency}`}
              onChange={(e) => {
                setRateStr(e.target.value);
                setRateManual(true);
              }}
            />
            {!(rateStr.trim() && !rate) && (rateInfo.status !== 'idle' || (rate && converted)) && (
              <div className="amt-note">
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
            {mode === 'exact' && <div className="amt-note">{t('expense.exactForeignHint', { currency })}</div>}
          </>
        )}
        {!expense && <ReceiptEntry g={g} />}
      </AmountCard>

      <Section
        bare
        title={t('expense.categorySection')}
        aside={categoryAuto ? <span className="hint">{t('expense.categoryAuto')}</span> : undefined}
      >
        <Chips>
          {CATEGORIES.map((c) => (
            <Chip
              key={c.id}
              selected={category === c.id}
              icon={categoryIcon(c.id)}
              tone={categoryTone(c.id)}
              onClick={() => {
                haptic.tap();
                setCategory(c.id);
                setCategoryPicked(true);
              }}
            >
              {t(categoryKey(c.id))}
            </Chip>
          ))}
        </Chips>
      </Section>

      <Section
        inset={60}
        footer={
          !expense
            ? foreign
              ? t('recurring.foreignHint')
              : repeatNext
                ? `${scheduleText(repeat as Period, repeatDay).replace(/^./, (c) => c.toUpperCase())}. ${t('recurring.hint', { date: shortDate(repeatNext) })}${repeat === 'monthly' && repeatDay >= 29 ? ` ${t('recurring.shortMonthHint')}` : ''}`
                : undefined
            : undefined
        }
      >
        <PickRow
          icon="users"
          title={t('expense.whoPaid')}
          value={
            <>
              <Avatar member={payer} size="xs" />
              {payer.id === g.meId ? t('common.you') : payer.name}
            </>
          }
          native={
            <select
              className="pick-native"
              aria-label={t('expense.whoPaid')}
              value={payerId}
              onChange={(e) => setPayerId(Number(e.target.value))}
            >
              {g.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {nameOf(m)}
                </option>
              ))}
            </select>
          }
        />
        <PickRow
          icon="calendar"
          title={t('expense.when')}
          value={formatDay(spentOn)}
          native={
            <input
              className="pick-native"
              type="date"
              aria-label={t('expense.when')}
              value={spentOn}
              max={todayIso()}
              onChange={(e) => setSpentOn(e.target.value || todayIso())}
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
        {!expense && (
          <PickRow
            icon="repeat"
            title={t('recurring.repeat')}
            value={repeatLabel[shownRepeat]}
            muted={shownRepeat === 'none'}
            native={
              <select
                className="pick-native"
                aria-label={t('recurring.repeat')}
                disabled={foreign}
                value={shownRepeat}
                onChange={(e) => {
                  haptic.tap();
                  setRepeat(e.target.value as Period | 'none');
                }}
              >
                {(['none', 'monthly', 'weekly'] as const).map((r) => (
                  <option key={r} value={r}>
                    {repeatLabel[r]}
                  </option>
                ))}
              </select>
            }
          />
        )}
      </Section>

      <Section
        inset={64}
        title={t('expense.splitWith')}
        aside={
          mode === 'equal' ? (
            <Button
              variant="ghost"
              size="s"
              onClick={() =>
                setParts((p) => Object.fromEntries(g.members.map((m) => [m.id, { ...p[m.id], on: !allOn }])))
              }
            >
              {allOn ? t('expense.deselectAll') : t('expense.selectAll')}
            </Button>
          ) : undefined
        }
        footer={splitFooter}
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
          const left = <Avatar member={m} size="m" />;

          if (mode === 'equal') {
            return (
              <Row
                key={m.id}
                onClick={() => {
                  haptic.tap();
                  update(m.id, { on: !p.on });
                }}
                left={left}
                title={nameOf(m)}
                right={
                  <span className="pick-value">
                    {p.on ? shareView : <span className="hint">—</span>}
                    <Check on={p.on} />
                  </span>
                }
              />
            );
          }
          if (mode === 'shares') {
            return (
              <Row
                key={m.id}
                left={left}
                title={nameOf(m)}
                subtitle={shareView}
                right={<Stepper value={p.weight} onChange={(weight) => update(m.id, { weight })} />}
              />
            );
          }
          return (
            <Row
              key={m.id}
              left={left}
              title={nameOf(m)}
              right={
                <Box
                  inputMode="decimal"
                  placeholder="0"
                  aria-label={nameOf(m)}
                  invalid={Boolean(p.exact.trim() && parseAmount(p.exact) === null)}
                  value={p.exact}
                  onChange={(e) => update(m.id, { exact: e.target.value })}
                />
              }
            />
          );
        })}
      </Section>

      {expense && (
        <Section>
          <Row
            tone="danger"
            className="center"
            left={<Icon name="trash" size={20} />}
            title={t('expense.delete')}
            onClick={remove}
          />
        </Section>
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
