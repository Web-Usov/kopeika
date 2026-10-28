import { useEffect, useRef, useState } from 'react';
import { type ActivityEntry, activityText } from '../../../shared/activity.ts';
import { type CategoryId, type CategoryTotal, categoryKey } from '../../../shared/categories.ts';
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
  shareLink,
  shareMessage,
} from '../tg.tsx';
import {
  Avatar,
  BalanceBlock,
  BalanceRow,
  Button,
  Card,
  CategoryStat,
  DayHeader,
  DebtCard,
  type DebtLine,
  DemoNote,
  EmptyState,
  ErrorView,
  ExpenseRow,
  formatDay,
  GroupActions,
  GroupHeader,
  Loading,
  Money,
  QuickInput,
  QuickPreview,
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
        <EmptyState icon="receipt" tone="gray" title={t('group.noExpenses')} hint={t('group.noExpensesHint')} />
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
      {[...byDay].map(([day, list]) => {
        // The day total counts expenses only, not transfers.
        const total = list.reduce((sum, e) => (e.kind === 'transfer' ? sum : sum + e.amount), 0);
        return (
          <DayHeader
            key={day}
            day={formatDay(day)}
            total={total > 0 ? <Money value={total} currency={g.currency} /> : undefined}
          >
            {list.map((e) => {
              if (e.kind === 'transfer') {
                const to = e.shares[0]?.memberId;
                return (
                  <ExpenseRow
                    key={e.id}
                    transfer
                    onClick={() => navigate(`/g/${g.id}/transfer/${e.id}`)}
                    title={`${name(e.payerId)} → ${name(to)}`}
                    subtitle={t('group.transfer')}
                    amount={<Money value={e.amount} currency={g.currency} />}
                  />
                );
              }
              const myShare = e.shares.find((s) => s.memberId === g.meId)?.amount ?? 0;
              const paidByMe = e.payerId === g.meId;
              return (
                <ExpenseRow
                  key={e.id}
                  category={e.category ?? 'other'}
                  onClick={() => navigate(`/g/${g.id}/expense/${e.id}`)}
                  title={e.title}
                  subtitle={paidByMe ? t('group.paidByMe') : t('group.paidBy', { name: name(e.payerId) })}
                  amount={<Money value={e.amount} currency={g.currency} />}
                  captions={[
                    ...(e.originalAmount !== null && e.originalCurrency
                      ? [formatMoney(e.originalAmount, e.originalCurrency, lang)]
                      : []),
                    myShare
                      ? rich('group.myShare', { amount: <Money value={myShare} currency={g.currency} /> })
                      : t('group.notInvolved'),
                  ]}
                />
              );
            })}
          </DayHeader>
        );
      })}
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
      className="quick-form"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <QuickInput
        aria-label={t('quick.label')}
        placeholder={t('quick.placeholder')}
        value={text}
        maxLength={140}
        enterKeyHint="done"
        onChange={(e) => setText(e.target.value)}
      />
      {parsed ? (
        <QuickPreview
          category={parsed.category}
          title={capitalize(parsed.title)}
          amount={formatMoney(parsed.amount, parsed.currency, lang)}
          tail={foreign ? t('quick.foreignTail') : t('quick.tail')}
        >
          {!foreign && (
            <Button type="submit" variant="primary" disabled={busy}>
              {t('quick.add')}
            </Button>
          )}
          <Button variant={foreign ? 'primary' : 'fill'} disabled={busy} onClick={foreign ? () => void add() : edit}>
            {foreign ? t('quick.setRate') : t('quick.edit')}
          </Button>
        </QuickPreview>
      ) : (
        text.trim() && <div className="quick-note">{t('quick.noAmount')}</div>
      )}
    </form>
  );
}

/** «Показать ещё»: loads the next page of older expenses; also fires by itself when scrolled into view. */
function LoadMore({ groupId }: { groupId: number }) {
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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
    <div ref={ref}>
      <Button variant="ghost" wide disabled={busy} onClick={more}>
        {busy ? t('common.loading') : t('group.showMore')}
      </Button>
    </div>
  );
}

function InviteHint({ g }: { g: GroupDetail }) {
  return (
    <EmptyState icon="userplus" title={t('group.soloTitle')} hint={t('group.soloHint')}>
      <Button variant="tint" onClick={() => invite(g)}>
        {t('group.soloInvite')}
      </Button>
    </EmptyState>
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
  const maxAbs = Math.max(1, ...g.members.map((m) => Math.abs(m.balance)));
  const owedToMe = g.settlements.filter((s) => s.to === g.meId);
  const iPay = g.settlements.filter((s) => s.from === g.meId);
  const others = g.settlements.filter((s) => s.to !== g.meId && s.from !== g.meId);
  const sum = (list: { amount: number }[]) => list.reduce((acc, s) => acc + s.amount, 0);
  const markTransfer = (s: { from: number; to: number; amount: number }) =>
    navigate(`/g/${g.id}/transfer/new?from=${s.from}&to=${s.to}&amount=${s.amount}`);

  return (
    <>
      {owedToMe.length > 0 && (
        <Section bare title={t('group.owedToYouTitle')} aside={<Money value={sum(owedToMe)} currency={g.currency} />}>
          <div className="debts">
            {owedToMe.map((s) => (
              <OwedCard key={s.from} g={g} debtor={member(s.from)} amount={s.amount} onMark={() => markTransfer(s)} />
            ))}
          </div>
        </Section>
      )}

      {iPay.length > 0 && (
        <Section bare title={t('group.youPayTitle')} aside={<Money value={sum(iPay)} currency={g.currency} />}>
          <div className="debts">
            {iPay.map((s) => (
              <PayCard key={s.to} g={g} to={member(s.to)} amount={s.amount} onMark={() => markTransfer(s)} />
            ))}
          </div>
        </Section>
      )}

      {others.length > 0 && (
        <Section title={t('group.othersTitle')}>
          {others.map((s) => (
            <Row
              key={`${s.from}-${s.to}`}
              title={`${member(s.from).name} → ${member(s.to).name}`}
              right={<Money value={s.amount} currency={g.currency} />}
              chevron
              onClick={() => markTransfer(s)}
            />
          ))}
        </Section>
      )}

      {g.settlements.length === 0 && (
        <Card>
          <EmptyState icon="check" tone="pos" title={t('group.allSettled')} />
        </Card>
      )}

      <Button variant="ghost" wide icon="plus" onClick={() => navigate(`/g/${g.id}/transfer/new`)}>
        {t('group.manualTransfer')}
      </Button>

      <Section title={t('group.balancesTitle')} footer={t('group.balancesFooter')} inset={60}>
        {g.members.map((m) => (
          <BalanceRow
            key={m.id}
            member={m}
            name={m.id === g.meId ? t('common.you') : m.name}
            value={m.balance}
            ratio={Math.abs(m.balance) / maxAbs}
            amount={m.balance === 0 ? '0' : <Money value={m.balance} currency={g.currency} signed />}
          />
        ))}
      </Section>

      <Stats g={g} />
    </>
  );
}

function Stats({ g }: { g: GroupDetail }) {
  // Category totals are computed by the server over all expenses, not from the loaded page.
  const [totals, setTotals] = useState<{ group: CategoryTotal[]; mine: CategoryTotal[] }>();
  const [scope, setScope] = useState<'group' | 'mine'>('group');
  const stamp = `${g.expensesTotal}:${g.totalSpent}`;
  useEffect(() => {
    api.stats(g.id).then(setTotals, () => {});
  }, [g.id, stamp]);
  if (!totals) return null;
  const list = totals[scope];
  const max = list[0]?.amount ?? 1;
  return (
    <Section title={t('group.statsTitle')} footer={scope === 'mine' ? t('group.statsFooter') : undefined} inset={60}>
      <Segmented
        value={scope}
        options={[
          { value: 'group', label: t('group.statsGroup') },
          { value: 'mine', label: t('group.statsMine') },
        ]}
        onChange={setScope}
      />
      {list.length === 0 ? (
        <div className="row hint">{scope === 'group' ? t('group.statsEmpty') : t('group.statsMineEmpty')}</div>
      ) : (
        list.map((c) => (
          <CategoryStat
            key={c.category}
            category={c.category}
            title={t(categoryKey(c.category))}
            amount={<Money value={c.amount} currency={g.currency} />}
            ratio={c.amount / max}
          />
        ))
      )}
    </Section>
  );
}

const spaced = (digits: string, size: number) => digits.replace(new RegExp(`(.{${size}})(?=.)`, 'g'), '$1 ');

/** Debt I owe: the creditor's details with one-tap copy buttons and "mark as paid". */
function PayCard({ g, to, amount, onMark }: { g: GroupDetail; to: Member; amount: number; onMark: () => void }) {
  const info: PaymentInfo = to.paymentInfo;
  const [copied, setCopied] = useState<string>();
  const copy = async (key: string, value: string) => {
    if (!(await copyText(value))) return;
    setCopied(key);
    setTimeout(() => setCopied(undefined), 2000);
  };
  const line = (key: string, text: string, value: string, label: string): DebtLine => ({
    text,
    copyLabel: copied === key ? t('payment.copied') : label,
    copied: copied === key,
    onCopy: () => copy(key, value),
  });
  const lines: DebtLine[] = [];
  if (info.phone || info.bank) {
    const text = [info.phone, info.bank].filter(Boolean).join(' · ');
    lines.push(line('phone', text, info.phone ?? text, info.phone ? t('payment.copyPhone') : t('payment.copy')));
  }
  if (info.card) lines.push(line('card', spaced(info.card, 4), info.card, t('payment.copyCard')));
  if (info.link) lines.push(line('link', info.link, info.link, t('payment.copyLink')));
  if (info.note) lines.push(line('note', info.note, info.note, t('payment.copy')));
  return (
    <DebtCard
      member={to}
      caption={t('group.youOweCaption')}
      amount={<Money value={amount} currency={g.currency} />}
      lines={hasPaymentInfo(info) ? lines : undefined}
      hint={hasPaymentInfo(info) ? undefined : t('payment.none', { name: to.name })}
    >
      <Button variant="tint" onClick={onMark}>
        {t('group.markTransfer')}
      </Button>
    </DebtCard>
  );
}

/** Debt owed to me: "mark as paid" and "remind" (the bot nudges the debtor; once a day per person). */
function OwedCard({
  g,
  debtor,
  amount,
  onMark,
}: {
  g: GroupDetail;
  debtor: Member;
  amount: number;
  onMark: () => void;
}) {
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
  return (
    <DebtCard
      member={debtor}
      caption={t('group.owesYou')}
      amount={<Money value={amount} currency={g.currency} />}
      reason={debtor.canNotify ? undefined : t('group.remindNoNotify', { name: debtor.name })}
    >
      <Button variant="tint" onClick={onMark}>
        {t('group.markTransfer')}
      </Button>
      <Button variant="fill" disabled={!debtor.canNotify || state !== 'idle'} onClick={remind}>
        {state === 'done' ? t('group.reminded') : t('group.remind')}
      </Button>
    </DebtCard>
  );
}
