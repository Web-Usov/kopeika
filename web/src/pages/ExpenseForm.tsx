import { useMemo, useState } from 'react';
import { amountToInput, computeShares, parseAmount, type SplitInput, type SplitMode } from '../../../shared/money.ts';
import { api, setGroup, useGroup, type Expense, type GroupDetail } from '../api.ts';
import { navigate } from '../router.ts';
import { BackButton, MainButton, alertDialog, confirmDialog, haptic } from '../tg.tsx';
import { Avatar, ErrorView, Loading, Money, Row, Section, Segmented, todayIso } from '../ui.tsx';

export function ExpenseForm({ groupId, expenseId }: { groupId: number; expenseId?: number }) {
  const { data: g, error } = useGroup(groupId);
  const back = <BackButton onClick={() => navigate(`/g/${groupId}`, { replace: true })} />;
  if (!g) return <div className="page">{back}{error ? <ErrorView message={error} /> : <Loading />}</div>;

  const expense = expenseId ? g.expenses.find((e) => e.id === expenseId && e.kind === 'expense') : undefined;
  if (expenseId && !expense) return <div className="page">{back}<ErrorView message="Трата не найдена" /></div>;
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
      weight: e?.splitMode === 'shares' ? s?.input ?? 0 : 1,
      exact: e?.splitMode === 'exact' && s ? amountToInput(s.input) : '',
    };
  }
  return out;
}

function Editor({ g, expense }: { g: GroupDetail; expense?: Expense }) {
  const [title, setTitle] = useState(expense?.title ?? '');
  const [amountStr, setAmountStr] = useState(expense ? amountToInput(expense.amount) : '');
  const [payerId, setPayerId] = useState(expense?.payerId ?? g.meId);
  const [spentOn, setSpentOn] = useState(expense?.spentOn ?? todayIso());
  const [mode, setMode] = useState<SplitMode>(expense?.splitMode ?? 'equal');
  const [parts, setParts] = useState(() => initialParticipants(g, expense));
  const [saving, setSaving] = useState(false);

  const amount = parseAmount(amountStr);
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
  const exactBadInput = mode === 'exact' && g.members.some((m) => parts[m.id].exact.trim() && parseAmount(parts[m.id].exact) === null);

  let computed: Map<number, number> | null = null;
  let splitError: string | null = null;
  if (amount) {
    try {
      computed = computeShares(amount, mode, inputs);
    } catch (e) {
      splitError = (e as Error).message;
    }
  }
  const valid = Boolean(title.trim() && amount && computed && !exactBadInput);

  const save = async () => {
    if (!amount || !computed) return;
    setSaving(true);
    const body = { title: title.trim(), amount, payerId, splitMode: mode, spentOn, shares: inputs };
    try {
      setGroup(expense ? await api.updateExpense(g.id, expense.id, body) : await api.addExpense(g.id, body));
      haptic.success();
      navigate(`/g/${g.id}`, { replace: true });
    } catch (e) {
      setSaving(false);
      haptic.error();
      await alertDialog((e as Error).message);
    }
  };

  const remove = async () => {
    if (!expense || !(await confirmDialog(`Удалить трату «${expense.title}»?`))) return;
    try {
      setGroup(await api.deleteExpense(g.id, expense.id));
      navigate(`/g/${g.id}`, { replace: true });
    } catch (e) {
      await alertDialog((e as Error).message);
    }
  };

  const allOn = g.members.every((m) => parts[m.id].on);

  return (
    <>
      <h2 className="page-title">{expense ? 'Трата' : 'Новая трата'}</h2>

      <Section>
        <input
          className="field"
          placeholder="За что? Например, ужин"
          value={title}
          maxLength={100}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="amount-field">
          <input
            className="field amount"
            inputMode="decimal"
            placeholder="0"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
          />
          <span className="currency">{g.currency}</span>
        </div>
        {amountStr && amount === null && <div className="field-error">Введите сумму, например 1500 или 99,90</div>}
      </Section>

      <Section title="Кто платил">
        <select className="field" value={payerId} onChange={(e) => setPayerId(Number(e.target.value))}>
          {g.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id === g.meId ? `${m.name} (вы)` : m.name}
            </option>
          ))}
        </select>
      </Section>

      <Section title="Когда">
        <input className="field" type="date" value={spentOn} max={todayIso()} onChange={(e) => setSpentOn(e.target.value || todayIso())} />
      </Section>

      <Section
        title={
          <span className="section-title-row">
            На кого делим
            {mode === 'equal' && (
              <button
                className="text-btn small"
                onClick={() => setParts((p) => Object.fromEntries(g.members.map((m) => [m.id, { ...p[m.id], on: !allOn }])))}
              >
                {allOn ? 'Снять всех' : 'Выбрать всех'}
              </button>
            )}
          </span>
        }
        footer={
          mode === 'exact' && amount ? (
            exactSum === amount ? (
              <span className="pos">✓ Сумма распределена полностью</span>
            ) : exactSum < amount ? (
              <>Осталось распределить <Money value={amount - exactSum} currency={g.currency} /></>
            ) : (
              <span className="neg">Распределено больше на <Money value={exactSum - amount} currency={g.currency} /></span>
            )
          ) : splitError && amount ? (
            <span className="neg">{splitError}</span>
          ) : mode === 'shares' ? (
            'Например, 2 доли — за двоих: себя и партнёра.'
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
            { value: 'equal', label: 'Поровну' },
            { value: 'shares', label: 'Долями' },
            { value: 'exact', label: 'Суммами' },
          ]}
        />
        {g.members.map((m) => {
          const p = parts[m.id];
          const share = computed?.get(m.id);
          const shareView = share ? <Money value={share} currency={g.currency} /> : <span className="hint">—</span>;
          const name = m.id === g.meId ? `${m.name} (вы)` : m.name;

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
                    <button onClick={() => update(m.id, { weight: Math.max(0, p.weight - 1) })} disabled={p.weight === 0}>
                      −
                    </button>
                    <span>{p.weight}</span>
                    <button onClick={() => update(m.id, { weight: Math.min(99, p.weight + 1) })}>+</button>
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

      {expense && (
        <button className="danger-btn" onClick={remove}>
          Удалить трату
        </button>
      )}

      <MainButton text={expense ? 'Сохранить' : 'Добавить трату'} onClick={save} disabled={!valid} loading={saving} />
    </>
  );
}
