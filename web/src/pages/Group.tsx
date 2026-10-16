import { Fragment, useState } from 'react';
import { type CategoryId, categoryEmoji, categoryKey, categoryTotals } from '../../../shared/categories.ts';
import { type Expense, type GroupDetail, hasPaymentInfo, type Member, type PaymentInfo, useGroup } from '../api.ts';
import { rich, t } from '../i18n.ts';
import { navigate } from '../router.ts';
import { BackButton, copyText, haptic, MainButton, openLink, shareLink } from '../tg.tsx';
import { Avatar, ErrorView, formatDay, Loading, Money, Row, Section, Segmented } from '../ui.tsx';

type Tab = 'expenses' | 'balances';

export function Group({ id, tab }: { id: number; tab: Tab }) {
  const { data: g, error } = useGroup(id);

  const back = <BackButton onClick={() => navigate('/', { replace: true })} />;
  if (!g)
    return (
      <div className="page">
        {back}
        {error ? <ErrorView message={error} /> : <Loading />}
      </div>
    );

  const me = g.members.find((m) => m.id === g.meId)!;

  return (
    <div className="page">
      {back}
      <header className="group-header">
        <h2>{g.name}</h2>
        <div className="hint">
          {rich('group.totalSpent', { amount: <Money value={g.totalSpent} currency={g.currency} /> })}
        </div>
        <div className={`my-balance ${me.balance > 0 ? 'pos' : me.balance < 0 ? 'neg' : ''}`}>
          {me.balance === 0
            ? t('group.settled')
            : me.balance > 0
              ? rich('group.owedToYou', { amount: <Money value={me.balance} currency={g.currency} /> })
              : rich('group.youOwe', { amount: <Money value={-me.balance} currency={g.currency} /> })}
        </div>
        <div className="header-actions">
          <button type="button" onClick={() => invite(g)}>
            {t('group.invite')}
          </button>
          <button type="button" onClick={() => navigate(`/g/${g.id}/settings`)}>
            {t('group.settings')}
          </button>
        </div>
      </header>

      <Segmented<Tab>
        value={tab}
        options={[
          { value: 'expenses', label: t('group.tabExpenses') },
          { value: 'balances', label: t('group.tabBalances') },
        ]}
        onChange={(t) => {
          haptic.tap();
          navigate(`/g/${g.id}${t === 'balances' ? '?tab=balances' : ''}`, { replace: true });
        }}
      />

      {tab === 'expenses' ? <ExpensesTab g={g} /> : <BalancesTab g={g} />}

      <MainButton text={t('group.addExpense')} onClick={() => navigate(`/g/${g.id}/expense/new`)} />
    </div>
  );
}

function invite(g: GroupDetail) {
  const link = g.inviteLink;
  if (!link) {
    navigate(`/g/${g.id}/settings`);
    return;
  }
  shareLink(link, t('group.inviteText', { name: g.name }));
}

function ExpensesTab({ g }: { g: GroupDetail }) {
  if (g.expenses.length === 0) {
    return (
      <div className="empty">
        <div className="empty-emoji">🧾</div>
        <p>{t('group.noExpenses')}</p>
        <p className="hint">{t('group.noExpensesHint')}</p>
      </div>
    );
  }
  const byDay = new Map<string, Expense[]>();
  for (const e of g.expenses) byDay.set(e.spentOn, [...(byDay.get(e.spentOn) ?? []), e]);
  const name = (id: number) =>
    id === g.meId ? t('common.you') : (g.members.find((m) => m.id === id)?.name ?? t('common.unknownMember'));

  return (
    <>
      {[...byDay].map(([day, list]) => (
        <Section key={day} title={formatDay(day)}>
          {list.map((e) => {
            if (e.kind === 'transfer') {
              const to = e.shares[0]?.memberId;
              return (
                <Row
                  key={e.id}
                  onClick={() => navigate(`/g/${g.id}/transfer/${e.id}`)}
                  left={<span className="expense-icon">💸</span>}
                  title={`${name(e.payerId)} → ${name(to)}`}
                  subtitle={t('group.transfer')}
                  right={<Money value={e.amount} currency={g.currency} />}
                />
              );
            }
            const myShare = e.shares.find((s) => s.memberId === g.meId)?.amount ?? 0;
            const paidByMe = e.payerId === g.meId;
            return (
              <Row
                key={e.id}
                onClick={() => navigate(`/g/${g.id}/expense/${e.id}`)}
                left={<span className="expense-icon">{categoryEmoji(e.category ?? 'other')}</span>}
                title={e.title}
                subtitle={paidByMe ? t('group.paidByMe') : t('group.paidBy', { name: name(e.payerId) })}
                right={
                  <span className="stack-right">
                    <Money value={e.amount} currency={g.currency} />
                    <span className="hint small">
                      {myShare
                        ? rich('group.myShare', { amount: <Money value={myShare} currency={g.currency} /> })
                        : t('group.notInvolved')}
                    </span>
                  </span>
                }
              />
            );
          })}
        </Section>
      ))}
    </>
  );
}

function BalancesTab({ g }: { g: GroupDetail }) {
  const member = (id: number) => g.members.find((m) => m.id === id)!;
  const label = (id: number) => (id === g.meId ? t('common.you') : member(id).name);
  const maxAbs = Math.max(1, ...g.members.map((m) => Math.abs(m.balance)));

  return (
    <>
      <Section title={t('group.balancesTitle')} footer={t('group.balancesFooter')}>
        {g.members.map((m) => (
          <Row
            key={m.id}
            left={<Avatar member={m} />}
            title={m.id === g.meId ? t('common.youParen', { name: m.name }) : m.name}
            subtitle={
              <span className="bar">
                <span
                  className={m.balance >= 0 ? 'pos' : 'neg'}
                  style={{ width: `${(Math.abs(m.balance) / maxAbs) * 100}%` }}
                />
              </span>
            }
            right={
              m.balance === 0 ? (
                <span className="hint">0</span>
              ) : (
                <Money value={m.balance} currency={g.currency} signed />
              )
            }
          />
        ))}
      </Section>

      <Section title={t('group.howToSettle')}>
        {g.settlements.length === 0 ? (
          <div className="row hint">{t('group.allSettled')}</div>
        ) : (
          g.settlements.map((s) => (
            <Fragment key={`${s.from}-${s.to}`}>
              <Row
                title={
                  <>
                    {label(s.from)} → {label(s.to)}
                  </>
                }
                subtitle={<Money value={s.amount} currency={g.currency} />}
                right={
                  <button
                    type="button"
                    className="small-btn"
                    onClick={() => navigate(`/g/${g.id}/transfer/new?from=${s.from}&to=${s.to}&amount=${s.amount}`)}
                  >
                    {t('group.returned')}
                  </button>
                }
              />
              {s.from === g.meId && <PaymentDetails to={member(s.to)} />}
            </Fragment>
          ))
        )}
      </Section>

      <button type="button" className="text-btn" onClick={() => navigate(`/g/${g.id}/transfer/new`)}>
        {t('group.manualTransfer')}
      </button>

      <Stats g={g} />
    </>
  );
}

function Stats({ g }: { g: GroupDetail }) {
  const { group, mine } = categoryTotals(g.expenses, g.meId);
  return (
    <>
      <Section title={`${t('group.statsTitle')} · ${t('group.statsGroup')}`}>
        <CategoryBars totals={group} currency={g.currency} empty={t('group.statsEmpty')} />
      </Section>
      <Section title={`${t('group.statsTitle')} · ${t('group.statsMine')}`} footer={t('group.statsFooter')}>
        <CategoryBars totals={mine} currency={g.currency} empty={t('group.statsMineEmpty')} />
      </Section>
    </>
  );
}

function CategoryBars({
  totals,
  currency,
  empty,
}: {
  totals: { category: CategoryId; amount: number }[];
  currency: string;
  empty: string;
}) {
  if (totals.length === 0) return <div className="row hint">{empty}</div>;
  const max = totals[0].amount;
  return (
    <>
      {totals.map((c) => (
        <Row
          key={c.category}
          left={<span className="expense-icon">{categoryEmoji(c.category)}</span>}
          title={t(categoryKey(c.category))}
          subtitle={
            <span className="bar">
              <span className="accent" style={{ width: `${(c.amount / max) * 100}%` }} />
            </span>
          }
          right={<Money value={c.amount} currency={currency} />}
        />
      ))}
    </>
  );
}

const spaced = (digits: string, size: number) => digits.replace(new RegExp(`(.{${size}})(?=.)`, 'g'), '$1 ');

/** What the debtor needs to pay the creditor: details with one-tap copy buttons. */
function PaymentDetails({ to }: { to: Member }) {
  const info: PaymentInfo = to.paymentInfo;
  const [copied, setCopied] = useState<'phone' | 'card'>();
  if (!hasPaymentInfo(info)) return <div className="row hint small">{t('payment.none', { name: to.name })}</div>;

  const copy = async (what: 'phone' | 'card') => {
    if (!(await copyText(info[what]!))) return;
    setCopied(what);
    setTimeout(() => setCopied(undefined), 2000);
  };

  return (
    <div className="row payment">
      {info.phone && <span className="payment-line">{[info.phone, info.bank].filter(Boolean).join(' · ')}</span>}
      {!info.phone && info.bank && <span className="payment-line">{info.bank}</span>}
      {info.card && <span className="payment-line">{spaced(info.card, 4)}</span>}
      {info.note && <span className="payment-line">{info.note}</span>}
      <div className="buttons-wrap">
        {info.phone && (
          <button type="button" className="small-btn" onClick={() => copy('phone')}>
            {copied === 'phone' ? t('payment.copied') : t('payment.copyPhone')}
          </button>
        )}
        {info.card && (
          <button type="button" className="small-btn" onClick={() => copy('card')}>
            {copied === 'card' ? t('payment.copied') : t('payment.copyCard')}
          </button>
        )}
        {info.link && (
          <button type="button" className="small-btn" onClick={() => openLink(info.link!)}>
            {t('payment.openLink')}
          </button>
        )}
      </div>
    </div>
  );
}
