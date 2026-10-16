import { useState } from 'react';
import { amountToInput, parseAmount } from '../../../shared/money.ts';
import { api, type Expense, type GroupDetail, useExpense, useGroup } from '../api.ts';
import { applySavedGroup } from '../celebration.ts';
import { t } from '../i18n.ts';
import { navigate } from '../router.ts';
import { alertDialog, BackButton, confirmDialog, haptic, MainButton } from '../tg.tsx';
import { ErrorView, Loading, Section, todayIso } from '../ui.tsx';

export function TransferForm({
  groupId,
  expenseId,
  prefill,
}: {
  groupId: number;
  expenseId?: number;
  prefill: URLSearchParams;
}) {
  const { data: g, error } = useGroup(groupId);
  const { expense: found, loading } = useExpense(groupId, expenseId, g);
  const back = <BackButton onClick={() => navigate(`/g/${groupId}?tab=balances`, { replace: true })} />;
  if (!g || loading)
    return (
      <div className="page">
        {back}
        {error ? <ErrorView message={error} /> : <Loading />}
      </div>
    );

  const transfer = found?.kind === 'transfer' ? found : undefined;
  if (expenseId && !transfer)
    return (
      <div className="page">
        {back}
        <ErrorView message={t('transfer.notFound')} />
      </div>
    );
  if (g.members.length < 2)
    return (
      <div className="page">
        {back}
        <ErrorView message={t('transfer.needTwo')} />
      </div>
    );
  return (
    <div className="page">
      {back}
      <Editor g={g} transfer={transfer} prefill={prefill} />
    </div>
  );
}

function Editor({ g, transfer, prefill }: { g: GroupDetail; transfer?: Expense; prefill: URLSearchParams }) {
  const isMember = (v: number) => g.members.some((m) => m.id === v);
  const pre = (k: string) => {
    const v = Number(prefill.get(k));
    return Number.isInteger(v) && v > 0 ? v : undefined;
  };
  const defaultFrom = transfer?.payerId ?? (isMember(pre('from') ?? 0) ? pre('from')! : g.meId);
  const defaultTo =
    transfer?.shares[0]?.memberId ??
    (isMember(pre('to') ?? 0) ? pre('to')! : g.members.find((m) => m.id !== defaultFrom)!.id);

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [amountStr, setAmountStr] = useState(
    transfer ? amountToInput(transfer.amount) : pre('amount') ? amountToInput(pre('amount')!) : '',
  );
  const [spentOn, setSpentOn] = useState(transfer?.spentOn ?? todayIso());
  const [saving, setSaving] = useState(false);

  const amount = parseAmount(amountStr);
  const valid = Boolean(amount && from !== to);
  const label = (id: number) => {
    const m = g.members.find((x) => x.id === id)!;
    return id === g.meId ? t('common.youParen', { name: m.name }) : m.name;
  };

  const save = async () => {
    if (!amount) return;
    setSaving(true);
    const body = {
      kind: 'transfer' as const,
      title: t('transfer.defaultTitle'),
      amount,
      payerId: from,
      splitMode: 'exact' as const,
      spentOn,
      shares: [{ memberId: to, value: amount }],
    };
    try {
      applySavedGroup(transfer ? await api.updateExpense(g.id, transfer.id, body) : await api.addExpense(g.id, body));
      haptic.success();
      navigate(`/g/${g.id}?tab=balances`, { replace: true });
    } catch (e) {
      setSaving(false);
      haptic.error();
      await alertDialog((e as Error).message);
    }
  };

  const remove = async () => {
    if (!transfer || !(await confirmDialog(t('transfer.confirmDelete')))) return;
    try {
      applySavedGroup(await api.deleteExpense(g.id, transfer.id));
      navigate(`/g/${g.id}?tab=balances`, { replace: true });
    } catch (e) {
      await alertDialog((e as Error).message);
    }
  };

  const options = g.members.map((m) => (
    <option key={m.id} value={m.id}>
      {label(m.id)}
    </option>
  ));

  return (
    <>
      <h2 className="page-title">{transfer ? t('transfer.titleEdit') : t('transfer.titleNew')}</h2>
      <p className="hint page-subtitle">{t('transfer.subtitle')}</p>

      <Section title={t('transfer.from')}>
        <select className="field" value={from} onChange={(e) => setFrom(Number(e.target.value))}>
          {options}
        </select>
      </Section>

      <Section title={t('transfer.to')}>
        <select className="field" value={to} onChange={(e) => setTo(Number(e.target.value))}>
          {options}
        </select>
        {from === to && <div className="field-error">{t('transfer.sameMember')}</div>}
      </Section>

      <Section title={t('transfer.amount')}>
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
      </Section>

      <Section title={t('transfer.when')}>
        <input
          className="field"
          type="date"
          value={spentOn}
          max={todayIso()}
          onChange={(e) => setSpentOn(e.target.value || todayIso())}
        />
      </Section>

      {transfer && (
        <button type="button" className="danger-btn" onClick={remove}>
          {t('transfer.delete')}
        </button>
      )}

      <MainButton text={t('transfer.save')} onClick={save} disabled={!valid} loading={saving} />
    </>
  );
}
