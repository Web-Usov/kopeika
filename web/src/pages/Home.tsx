import { useEffect, useState } from 'react';
import { api, clearCache, type GroupSummary, hasPaymentInfo, type PaymentInfo, useGroups } from '../api.ts';
import { rich, t } from '../i18n.ts';
import { navigate } from '../router.ts';
import { alertDialog, closeApp, confirmDialog, haptic, inTelegram, MainButton, requestWriteAccess } from '../tg.tsx';
import { ErrorView, Loading, Money, Row, Section } from '../ui.tsx';
import { PaymentForm } from './PaymentForm.tsx';

const ARCHIVE_KEY = 'kopeika.archiveOpen';
function readArchiveOpen() {
  try {
    return localStorage.getItem(ARCHIVE_KEY) === '1';
  } catch {
    return false;
  }
}

export function Home() {
  const { data: groups, error } = useGroups();
  const [gone, setGone] = useState(false);

  const [archiveOpen, setArchiveOpen] = useState(readArchiveOpen);
  const toggleArchive = () => {
    setArchiveOpen(!archiveOpen);
    try {
      localStorage.setItem(ARCHIVE_KEY, archiveOpen ? '0' : '1');
    } catch {}
  };
  const active = groups?.filter((g) => !g.archived) ?? [];
  const archived = groups?.filter((g) => g.archived) ?? [];

  const groupRow = (g: GroupSummary) => (
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
  );

  if (gone) return <Goodbye />;

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
        <>
          {active.length > 0 && <Section title={t('home.myGroups')}>{active.map(groupRow)}</Section>}
          {archived.length > 0 && (
            <Section>
              <Row
                title={t('home.archive', { count: archived.length })}
                onClick={toggleArchive}
                right={<span className="hint">{archiveOpen ? '⌃' : '⌄'}</span>}
              />
              {archiveOpen && archived.map(groupRow)}
            </Section>
          )}
        </>
      )}

      {groups && <MyPaymentInfo />}

      {groups && <NotifySetting />}

      {groups && <DeleteData onDeleted={() => setGone(true)} />}

      <button type="button" className="footer-link" onClick={() => navigate('/privacy')}>
        {t('account.privacy')}
      </button>
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

function DeleteData({ onDeleted }: { onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!(await confirmDialog(t('account.confirmFirst')))) return;
    if (!(await confirmDialog(t('account.confirmSecond')))) return;
    setBusy(true);
    try {
      await api.deleteMe();
      clearCache();
      haptic.success();
      onDeleted();
    } catch (e) {
      await alertDialog((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section footer={t('account.deleteFooter')}>
      <button type="button" className="danger-btn" disabled={busy} onClick={() => void remove()}>
        {t('account.deleteData')}
      </button>
    </Section>
  );
}

function Goodbye() {
  return (
    <div className="page">
      <div className="empty">
        <div className="empty-emoji">👋</div>
        <p>
          <b>{t('account.goodbyeTitle')}</b>
        </p>
        <p className="hint">{t('account.goodbyeText')}</p>
        {inTelegram && <MainButton text={t('account.goodbyeClose')} onClick={closeApp} />}
      </div>
    </div>
  );
}
