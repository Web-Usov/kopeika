import { useEffect, useState } from 'react';
import { api, useGroups } from '../api.ts';
import { navigate } from '../router.ts';
import { alertDialog, inTelegram, MainButton, requestWriteAccess } from '../tg.tsx';
import { ErrorView, Loading, Money, plural, Row, Section } from '../ui.tsx';

export function Home() {
  const { data: groups, error } = useGroups();

  return (
    <div className="page">
      <header className="hero">
        <div className="hero-emoji">🪙</div>
        <h1>Копейка</h1>
        <p className="hint">Общие траты без споров</p>
      </header>

      {error && !groups ? (
        <ErrorView message={error} />
      ) : !groups ? (
        <Loading />
      ) : groups.length === 0 ? (
        <div className="empty">
          <p>Пока нет ни одной группы.</p>
          <p className="hint">
            Создайте группу для поездки, дачи или общей квартиры, пригласите друзей и записывайте, кто за что платил.
          </p>
        </div>
      ) : (
        <Section title="Мои группы">
          {groups.map((g) => (
            <Row
              key={g.id}
              onClick={() => navigate(`/g/${g.id}`)}
              title={g.name}
              subtitle={
                <>
                  {g.membersCount} {plural(g.membersCount, 'участник', 'участника', 'участников')} · потрачено{' '}
                  <Money value={g.totalSpent} currency={g.currency} />
                </>
              }
              right={
                g.myBalance === 0 ? (
                  <span className="hint">в расчёте</span>
                ) : (
                  <Money value={g.myBalance} currency={g.currency} signed />
                )
              }
            />
          ))}
        </Section>
      )}

      {groups && <NotifySetting />}

      <MainButton text="Создать группу" onClick={() => navigate('/new')} />
    </div>
  );
}

function NotifySetting() {
  const [notify, setNotify] = useState<boolean>();
  useEffect(() => {
    api.me().then(
      (me) => setNotify(me.notify),
      () => {},
    );
  }, []);
  if (notify === undefined) return null;

  const toggle = async () => {
    const next = !notify;
    if (next && inTelegram && !(await requestWriteAccess())) {
      await alertDialog('Без разрешения бот не сможет присылать уведомления.');
      return;
    }
    setNotify(next);
    await api.setNotify(next).catch(() => setNotify(!next));
  };

  return (
    <Section footer="Бот пришлёт сообщение, когда в группе появится трата с вашим участием.">
      <Row title="Уведомления о тратах" onClick={toggle} right={<span className={`switch ${notify ? 'on' : ''}`} />} />
    </Section>
  );
}
