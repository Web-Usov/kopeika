import { Fragment, useEffect, useRef, useState } from 'react';
import { type ActivityEntry, activityText } from '../../../shared/activity.ts';
import { type CategoryId, type CategoryTotal, categoryEmoji, categoryKey } from '../../../shared/categories.ts';
import { formatMoney } from '../../../shared/money.ts';
import { parseQuickExpense } from '../../../shared/quickExpense.ts';
import {
  type ApiError,
  api,
  type Expense,
  forgetGroup,
  type GroupDetail,
  hasPaymentInfo,
  loadMoreExpenses,
  type Member,
  type PaymentInfo,
  useGroup,
} from '../api.ts';
import { Celebration } from '../Celebration.tsx';
import { applySavedGroup } from '../celebration.ts';
import { dismissFinishOffer, finishOfferDismissed, finishTrip, isAllSettled } from '../finish.ts';
import { dateLocale, lang, rich, t } from '../i18n.ts';
import { setQuickDraft } from '../quickDraft.ts';
import { navigate } from '../router.ts';
import {
  alertDialog,
  BackButton,
  canShareMessage,
  confirmDialog,
  copyText,
  haptic,
  MainButton,
  openLink,
  shareLink,
  shareMessage,
} from '../tg.tsx';
import {
  Avatar,
  BalanceBlock,
  Button,
  DemoNote,
  ErrorView,
  formatDay,
  GroupActions,
  GroupHeader,
  Loading,
  Money,
  Row,
  Section,
  Segmented,
  todayIso,
} from '../ui.tsx';

export type Tab = 'expenses' | 'balances' | 'history';

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
  const achievementList = g.achievements;
  const unlockedCount = achievementList.filter((a) => a.unlocked).length;

  return (
    <div className="page">
      {back}
      {g.isDemo && <DemoBanner g={g} />}
      {!g.isDemo && !g.archived && isAllSettled(g) && <FinishBanner g={g} />}
      <GroupHeader
        title={g.name}
        subtitle={rich('group.headerSub', {
          members: t('common.members', { count: g.members.length }),
          amount: <Money value={g.totalSpent} currency={g.currency} />,
        })}
        settingsLabel={t('group.settings')}
        onSettings={() => navigate(`/g/${g.id}/settings`)}
      >
        <GroupBalance g={g} balance={me.balance} />
        <GroupActions
          items={[
            { icon: 'userplus', label: t('group.tileInvite'), onClick: () => invite(g) },
            ...(g.isDemo
              ? []
              : [{ icon: 'chat' as const, label: t('group.tileChat'), onClick: () => void shareBalance(g) }]),
            {
              icon: 'trophy',
              label: t('group.tileSummary'),
              onClick: () => navigate(`/g/${g.id}/summary`),
              badge: t('achievements.counter', { done: unlockedCount, total: achievementList.length }),
            },
          ]}
        />
      </GroupHeader>

      <Segmented<Tab>
        value={tab}
        options={[
          { value: 'expenses', label: t('group.tabExpenses') },
          { value: 'balances', label: t('group.tabBalances') },
          { value: 'history', label: t('activity.tab') },
        ]}
        onChange={(t) => {
          haptic.tap();
          navigate(`/g/${g.id}${t === 'expenses' ? '' : `?tab=${t}`}`, { replace: true });
        }}
      />

      {tab === 'expenses' ? <ExpensesTab g={g} /> : tab === 'balances' ? <BalancesTab g={g} /> : <HistoryTab g={g} />}

      <MainButton text={t('group.addExpense')} onClick={() => navigate(`/g/${g.id}/expense/new`)} />
      <Celebration groupId={g.id} />
    </div>
  );
}

/** Баланс в шапке: сумма по знаку и кнопка, которая ведёт на «Балансы». */
function GroupBalance({ g, balance }: { g: GroupDetail; balance: number }) {
  const toBalances = () => navigate(`/g/${g.id}?tab=balances`, { replace: true });
  if (balance === 0) {
    // Пустая группа — «Баланс / 0 ₽», группа с тратами — «Баланс / Вы в расчёте».
    return g.expenses.length === 0 ? (
      <BalanceBlock tone="zero" label={t('group.balance')} amount={<Money value={0} currency={g.currency} />} />
    ) : (
      <BalanceBlock tone="zero" label={t('group.balance')} text={t('group.settled')} />
    );
  }
  const owed = balance > 0;
  return (
    <BalanceBlock
      tone={owed ? 'pos' : 'neg'}
      label={owed ? t('group.owedLabel') : t('group.oweLabel')}
      amount={<Money value={Math.abs(balance)} currency={g.currency} />}
      action={
        <Button variant="fill" size="s" onClick={toBalances}>
          {owed ? t('group.remind') : t('group.settle')}
        </Button>
      }
    />
  );
}

/** «Everyone is settled up. Finish the trip?»; «Not now» hides it until the next entry in the group. */
function FinishBanner({ g }: { g: GroupDetail }) {
  const [, rerender] = useState(0);
  if (finishOfferDismissed(g)) return null;
  return (
    <div className="banner finish-banner">
      <div>{t('group.allSettledBanner')}</div>
      <div className="banner-actions">
        <button type="button" className="chip finish-yes" onClick={() => void finishTrip(g)}>
          {t('group.finish')}
        </button>
        <button
          type="button"
          className="chip"
          onClick={() => {
            dismissFinishOffer(g);
            rerender((n) => n + 1);
          }}
        >
          {t('group.finishLater')}
        </button>
      </div>
    </div>
  );
}

function DemoBanner({ g }: { g: GroupDetail }) {
  const remove = async () => {
    if (!(await confirmDialog(t('group.demoConfirmDelete')))) return;
    try {
      await api.deleteGroup(g.id);
      forgetGroup(g.id);
      navigate('/', { replace: true });
    } catch (e) {
      await alertDialog((e as Error).message);
    }
  };
  return <DemoNote text={t('group.demoBanner')} actionLabel={t('group.demoDelete')} onAction={() => void remove()} />;
}

/** Sends the balance card to a chosen chat; on clients without shareMessage falls back to the invite link share. */
async function shareBalance(g: GroupDetail) {
  if (!canShareMessage()) return invite(g);
  try {
    const { id } = await api.prepareShare(g.id, 'balance');
    await shareMessage(id);
  } catch (e) {
    await alertDialog((e as Error).message);
  }
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
  // A real group with only its creator in it: the next step is inviting people.
  const solo = !g.isDemo && g.members.length === 1;
  if (g.expenses.length === 0) {
    return (
      <>
        <QuickAdd g={g} />
        <div className="empty">
          <div className="empty-emoji">🧾</div>
          <p>{t('group.noExpenses')}</p>
          <p className="hint">{t('group.noExpensesHint')}</p>
        </div>
        {solo && <InviteHint g={g} />}
      </>
    );
  }
  const byDay = new Map<string, Expense[]>();
  for (const e of g.expenses) byDay.set(e.spentOn, [...(byDay.get(e.spentOn) ?? []), e]);
  const name = (id: number) =>
    id === g.meId ? t('common.you') : (g.members.find((m) => m.id === id)?.name ?? t('common.unknownMember'));

  return (
    <>
      <QuickAdd g={g} />
      {solo && <InviteHint g={g} />}
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
                    {e.originalAmount !== null && e.originalCurrency && (
                      <span className="hint small">{formatMoney(e.originalAmount, e.originalCurrency, lang)}</span>
                    )}
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
      {g.hasMoreExpenses && <LoadMore groupId={g.id} />}
    </>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** «Быстрая трата»: a line like «1200 такси» becomes an equal-split expense paid by me, or opens the form. */
function QuickAdd({ g }: { g: GroupDetail }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const parsed = parseQuickExpense(text, { lang, groupCurrency: g.currency });
  const foreign = Boolean(parsed && parsed.currency !== g.currency);

  const edit = () => {
    if (!parsed) return;
    setQuickDraft(g.id, { ...parsed, title: capitalize(parsed.title) });
    navigate(`/g/${g.id}/expense/new`);
  };
  const add = async () => {
    if (!parsed || busy) return;
    if (foreign) return edit(); // the rate needs a look first
    setBusy(true);
    try {
      const saved = await api.addExpense(g.id, {
        title: capitalize(parsed.title),
        amount: parsed.amount,
        payerId: g.meId,
        splitMode: 'equal',
        spentOn: todayIso(),
        category: parsed.category,
        shares: g.members.map((m) => ({ memberId: m.id, value: 1 })),
      });
      applySavedGroup(saved);
      haptic.success();
      setText('');
    } catch (e) {
      haptic.error();
      await alertDialog((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="quick-add"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <input
        className="quick-input"
        aria-label={t('quick.label')}
        placeholder={t('quick.placeholder')}
        value={text}
        maxLength={140}
        enterKeyHint="done"
        onChange={(e) => setText(e.target.value)}
      />
      {parsed ? (
        <div className="quick-preview">
          <span className="quick-chip">
            {[
              `${categoryEmoji(parsed.category)} ${capitalize(parsed.title)}`,
              formatMoney(parsed.amount, parsed.currency, lang),
              foreign ? t('quick.foreignTail') : t('quick.tail'),
            ].join(' · ')}
          </span>
          <span className="quick-actions">
            {!foreign && (
              <button type="submit" className="small-btn primary" disabled={busy}>
                {t('quick.add')}
              </button>
            )}
            <button
              type="button"
              className={`small-btn ${foreign ? 'primary' : ''}`}
              disabled={busy}
              onClick={foreign ? () => void add() : edit}
            >
              {foreign ? t('quick.setRate') : t('quick.edit')}
            </button>
          </span>
        </div>
      ) : (
        text.trim() && <div className="hint small quick-hint">{t('quick.noAmount')}</div>
      )}
    </form>
  );
}

/** «Показать ещё»: loads the next page of older expenses; also fires by itself when scrolled into view. */
function LoadMore({ groupId }: { groupId: number }) {
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const more = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await loadMoreExpenses(groupId);
    } catch (e) {
      await alertDialog((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const latest = useRef(more);
  latest.current = more;
  // Re-observed after each page (the button is re-created when the list grows past the viewport).
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void latest.current();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [busy]);
  return (
    <button type="button" ref={ref} className="text-btn" disabled={busy} onClick={more}>
      {busy ? t('common.loading') : t('group.showMore')}
    </button>
  );
}

function InviteHint({ g }: { g: GroupDetail }) {
  return (
    <div className="empty">
      <p>{t('group.soloTitle')}</p>
      <p className="hint">{t('group.soloHint')}</p>
      <button type="button" className="small-btn primary" onClick={() => invite(g)}>
        {t('group.soloInvite')}
      </button>
    </div>
  );
}

function whenText(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = new Intl.DateTimeFormat(dateLocale, { hour: '2-digit', minute: '2-digit' }).format(d);
  if (d.toDateString() === now.toDateString()) return time;
  const date = new Intl.DateTimeFormat(dateLocale, {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  }).format(d);
  return `${date}, ${time}`;
}

function HistoryTab({ g }: { g: GroupDetail }) {
  const [items, setItems] = useState<ActivityEntry[]>();
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const load = async (before?: number) => {
    setBusy(true);
    try {
      const page = await api.activity(g.id, before);
      setItems((old) => [...(before ? (old ?? []) : []), ...page.items]);
      setNext(page.nextBefore);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // Reload when the group changes under us (e.g. a rename), so fresh entries show up.
  useEffect(() => {
    load();
  }, [g.id, g.expensesTotal, g.name, g.members.length]);

  if (error && !items) return <ErrorView message={error} />;
  if (!items) return <Loading />;
  if (items.length === 0) {
    return (
      <div className="empty">
        <div className="empty-emoji">🕓</div>
        <p>{t('activity.empty')}</p>
        <p className="hint">{t('activity.emptyHint')}</p>
      </div>
    );
  }
  return (
    <Section>
      {items.map((e) => (
        <Row
          key={e.id}
          className="activity"
          left={
            <Avatar
              member={g.members.find((m) => m.id === e.actor.memberId) ?? { id: 0, name: e.actor.name, photoUrl: null }}
            />
          }
          title={activityText(lang, e, g.currency)}
          subtitle={whenText(e.createdAt)}
        />
      ))}
      {next !== null && (
        <button type="button" className="text-btn" disabled={busy} onClick={() => load(next)}>
          {t('activity.loadMore')}
        </button>
      )}
    </Section>
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
              {s.to === g.meId && <RemindRow g={g} debtor={member(s.from)} />}
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
  // Category totals are computed by the server over all expenses, not from the loaded page.
  const [totals, setTotals] = useState<{ group: CategoryTotal[]; mine: CategoryTotal[] }>();
  const stamp = `${g.expensesTotal}:${g.totalSpent}`;
  useEffect(() => {
    api.stats(g.id).then(setTotals, () => {});
  }, [g.id, stamp]);
  if (!totals) return null;
  const { group, mine } = totals;
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

/** "Remind" under a debt owed to me: the bot nudges the debtor; once a day per person. */
function RemindRow({ g, debtor }: { g: GroupDetail; debtor: Member }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const remind = async () => {
    setState('busy');
    try {
      await api.remind(g.id, debtor.id);
      haptic.success();
      setState('done');
    } catch (e) {
      haptic.error();
      // 429 ("already reminded today") is final for today too: keep the button off.
      setState((e as ApiError).status === 429 ? 'done' : 'idle');
      await alertDialog((e as Error).message);
    }
  };
  if (!debtor.canNotify) {
    return (
      <div className="row buttons-wrap-row">
        <button type="button" className="small-btn" disabled>
          {t('group.remind')}
        </button>
        <span className="hint small">{t('group.remindNoNotify', { name: debtor.name })}</span>
      </div>
    );
  }
  return (
    <div className="row buttons-wrap-row">
      <button type="button" className="small-btn" disabled={state !== 'idle'} onClick={remind}>
        {state === 'done' ? t('group.reminded') : t('group.remind')}
      </button>
    </div>
  );
}
