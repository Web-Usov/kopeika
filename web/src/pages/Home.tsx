import { useEffect, useState } from 'react';
import { api, hasPaymentInfo, type PaymentInfo, useGroups } from '../api.ts';
import { rich, t } from '../i18n.ts';
import { navigate } from '../router.ts';
import { alertDialog, inTelegram, MainButton, requestWriteAccess } from '../tg.tsx';
import { ErrorView, Loading, Money, Row, Section } from '../ui.tsx';
import { PaymentForm } from './PaymentForm.tsx';

export function Home() {
  const { data: groups, error } = useGroups();

  return (
    <div className="page">
      <header className="hero">
        <div className="hero-emoji">🪙</div>
        <h1>{t('common.brand')}</h1>
        <p className="hint">{t('common.tagline')}</p>
      </header>

      {error && !groups ? (
        <ErrorView message={error} />
      ) : !groups ? (
        <Loading />
      ) : groups.length === 0 ? (
        <div className="empty">
          <p>{t('home.emptyTitle')}</p>
          <p className="hint">{t('home.emptyHint')}</p>
        </div>
      ) : (
        <Section title={t('home.myGroups')}>
          {groups.map((g) => (
            <Row
              key={g.id}
              onClick={() => navigate(`/g/${g.id}`)}
              title={g.name}
              subtitle={rich('home.groupSubtitle', {
                members: t('common.members', { count: g.membersCount }),
                spent: <Money value={g.totalSpent} currency={g.currency} />,
              })}
              right={
                g.myBalance === 0 ? (
                  <span className="hint">{t('home.settled')}</span>
                ) : (
                  <Money value={g.myBalance} currency={g.currency} signed />
                )
              }
            />
          ))}
        </Section>
      )}

      {groups && <MyPaymentInfo />}

      {groups && <NotifySetting />}

      <p className="app-version">{t('common.version', { version: __APP_VERSION__ })}</p>

      <MainButton text={t('home.createGroup')} onClick={() => navigate('/new')} />
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
      await alertDialog(t('home.notifyDenied'));
      return;
    }
    setNotify(next);
    await api.setNotify(next).catch(() => setNotify(!next));
  };

  return (
    <Section footer={t('home.notifyFooter')}>
      <Row title={t('home.notifyTitle')} onClick={toggle} right={<span className={`switch ${notify ? 'on' : ''}`} />} />
    </Section>
  );
}

function MyPaymentInfo() {
  const [info, setInfo] = useState<PaymentInfo>();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    api.myPaymentInfo().then(setInfo, () => {});
  }, []);
  if (!info) return null;

  if (!open)
    return (
      <Section footer={t('payment.myFooter')}>
        <Row
          title={t('payment.mySection')}
          onClick={() => setOpen(true)}
          right={
            <span className="hint">
              {hasPaymentInfo(info) ? t('payment.mySummaryFilled') : t('payment.mySummaryEmpty')} ›
            </span>
          }
        />
      </Section>
    );
  return (
    <PaymentForm
      title={t('payment.mySection')}
      footer={t('payment.myFooter')}
      initial={info}
      onSave={async (next) => {
        const saved = await api.setMyPaymentInfo(next);
        setInfo(saved);
        return saved;
      }}
    />
  );
}
