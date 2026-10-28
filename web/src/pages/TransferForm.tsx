import { useState } from 'react';
import { amountToInput, formatMoney, parseAmount } from '../../../shared/money.ts';
import { api, type Expense, type GroupDetail, useExpense, useGroup } from '../api.ts';
import { applySavedGroup } from '../celebration.ts';
import { lang, t } from '../i18n.ts';
import { Icon } from '../icons.tsx';
import { navigate } from '../router.ts';
import { alertDialog, BackButton, confirmDialog, haptic, MainButton } from '../tg.tsx';
import {
  AmountCard,
  AmountChip,
  ErrorView,
  formatDay,
  Loading,
  PickRow,
  Row,
  Screen,
  ScreenTitle,
  Section,
  TransferPair,
  todayIso,
} from '../ui.tsx';

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
    <Screen>
      {back}
      <Editor g={g} transfer={transfer} prefill={prefill} />
    </Screen>
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

  const settlement = g.settlements.find((s) => s.from === from && s.to === to);
  return (
    <>
      <ScreenTitle lead={t('transfer.subtitle')}>
        {transfer ? t('transfer.titleEdit') : t('transfer.titleNew')}
      </ScreenTitle>

      <TransferPair
        members={g.members.map((m) => ({ ...m, label: label(m.id) }))}
        from={{
          value: from,
          label: t('transfer.from'),
          display: from === g.meId ? t('common.you') : undefined,
          onChange: setFrom,
        }}
        to={{
          value: to,
          label: t('transfer.to'),
          display: to === g.meId ? t('transfer.toMe') : undefined,
          onChange: setTo,
        }}
        error={from === to ? t('transfer.sameMember') : undefined}
      />

      <AmountCard
        label={t('transfer.amount')}
        value={amountStr}
        onChange={setAmountStr}
        currency={{ value: g.currency, label: t('expense.currencyLabel') }}
      >
        {settlement && (
          <AmountChip
            selected={amount === settlement.amount}
            onClick={() => {
              haptic.tap();
              setAmountStr(amountToInput(settlement.amount));
            }}
          >
            {t('transfer.wholeDebt', { amount: formatMoney(settlement.amount, g.currency, lang) })}
          </AmountChip>
        )}
        <PickRow
          icon="calendar"
          title={t('transfer.when')}
          value={formatDay(spentOn)}
          native={
            <input
              className="pick-native"
              type="date"
              aria-label={t('transfer.when')}
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
      </AmountCard>

      {transfer && (
        <Section>
          <Row
            tone="danger"
            className="center"
            left={<Icon name="trash" size={20} />}
            title={t('transfer.delete')}
            onClick={remove}
          />
        </Section>
      )}

      <MainButton text={t('transfer.save')} onClick={save} disabled={!valid} loading={saving} />
    </>
  );
}
