import { type Expense, type GroupDetail, useGroup } from '../api.ts';
import { navigate } from '../router.ts';
import { BackButton, haptic, MainButton, shareLink } from '../tg.tsx';
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
          Всего потрачено <Money value={g.totalSpent} currency={g.currency} />
        </div>
        <div className={`my-balance ${me.balance > 0 ? 'pos' : me.balance < 0 ? 'neg' : ''}`}>
          {me.balance === 0 ? (
            'Вы в расчёте'
          ) : me.balance > 0 ? (
            <>
              Вам должны <Money value={me.balance} currency={g.currency} />
            </>
          ) : (
            <>
              Вы должны <Money value={-me.balance} currency={g.currency} />
            </>
          )}
        </div>
        <div className="header-actions">
          <button type="button" onClick={() => invite(g)}>
            👋 Пригласить
          </button>
          <button type="button" onClick={() => navigate(`/g/${g.id}/settings`)}>
            ⚙️ Группа
          </button>
        </div>
      </header>

      <Segmented<Tab>
        value={tab}
        options={[
          { value: 'expenses', label: 'Траты' },
          { value: 'balances', label: 'Балансы' },
        ]}
        onChange={(t) => {
          haptic.tap();
          navigate(`/g/${g.id}${t === 'balances' ? '?tab=balances' : ''}`, { replace: true });
        }}
      />

      {tab === 'expenses' ? <ExpensesTab g={g} /> : <BalancesTab g={g} />}

      <MainButton text="Добавить трату" onClick={() => navigate(`/g/${g.id}/expense/new`)} />
    </div>
  );
}

function invite(g: GroupDetail) {
  const link = g.inviteLink;
  if (!link) {
    navigate(`/g/${g.id}/settings`);
    return;
  }
  shareLink(link, `Присоединяйся к группе «${g.name}» в Копейке — будем вместе считать общие траты`);
}

function ExpensesTab({ g }: { g: GroupDetail }) {
  if (g.expenses.length === 0) {
    return (
      <div className="empty">
        <div className="empty-emoji">🧾</div>
        <p>Трат пока нет</p>
        <p className="hint">Нажмите «Добавить трату», когда кто-то за что-то заплатит.</p>
      </div>
    );
  }
  const byDay = new Map<string, Expense[]>();
  for (const e of g.expenses) byDay.set(e.spentOn, [...(byDay.get(e.spentOn) ?? []), e]);
  const name = (id: number) => (id === g.meId ? 'Вы' : (g.members.find((m) => m.id === id)?.name ?? '?'));

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
                  subtitle="Перевод"
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
                left={<span className="expense-icon">🧾</span>}
                title={e.title}
                subtitle={`${paidByMe ? 'Вы платили' : `Платил(а) ${name(e.payerId)}`}`}
                right={
                  <span className="stack-right">
                    <Money value={e.amount} currency={g.currency} />
                    <span className="hint small">
                      {myShare ? (
                        <>
                          ваша доля <Money value={myShare} currency={g.currency} />
                        </>
                      ) : (
                        'вы не участвуете'
                      )}
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
  const label = (id: number) => (id === g.meId ? 'Вы' : member(id).name);
  const maxAbs = Math.max(1, ...g.members.map((m) => Math.abs(m.balance)));

  return (
    <>
      <Section title="Балансы" footer="Плюс — группа должна участнику, минус — участник должен группе.">
        {g.members.map((m) => (
          <Row
            key={m.id}
            left={<Avatar member={m} />}
            title={m.id === g.meId ? `${m.name} (вы)` : m.name}
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

      <Section title="Как рассчитаться">
        {g.settlements.length === 0 ? (
          <div className="row hint">Все в расчёте 🎉</div>
        ) : (
          g.settlements.map((s) => (
            <Row
              key={`${s.from}-${s.to}`}
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
                  Вернул
                </button>
              }
            />
          ))
        )}
      </Section>

      <button type="button" className="text-btn" onClick={() => navigate(`/g/${g.id}/transfer/new`)}>
        Записать перевод вручную
      </button>
    </>
  );
}
