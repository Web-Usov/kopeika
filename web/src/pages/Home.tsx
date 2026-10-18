import { useEffect, useState } from 'react';
import { api, clearCache, type GroupSummary, hasPaymentInfo, type PaymentInfo, setGroup, useGroups } from '../api.ts';
import { rich, t } from '../i18n.ts';
import { Icon } from '../icons.tsx';
import { navigate } from '../router.ts';
import { alertDialog, closeApp, confirmDialog, haptic, inTelegram, MainButton, requestWriteAccess } from '../tg.tsx';
import {
  Badge,
  Button,
  EmptyState,
  ErrorView,
  LegalLinks,
  Loading,
  Money,
  Row,
  RowValue,
  Screen,
  ScreenTitle,
  Section,
  Steps,
  Switch,
  Tile,
  type TileTone,
} from '../ui.tsx';
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
      left={<Tile text={groupInitial(g.name)} tone={`a${(g.id % 7) + 1}` as TileTone} />}
      onClick={() => navigate(`/g/${g.id}`)}
      title={g.name}
      subtitle={
        <>
          {g.isDemo && <Badge tone="brand">{t('home.demoBadge')}</Badge>}{' '}
          {rich('home.groupSubtitle', {
            members: t('common.members', { count: g.membersCount }),
            spent: <Money value={g.totalSpent} currency={g.currency} />,
          })}
        </>
      }
      right={
        g.myBalance === 0 ? (
          <span className="hint">{t('home.settled')}</span>
        ) : (
          <RowValue
            amount={
              <span className={g.myBalance > 0 ? 'pos' : 'neg'}>
                <Money value={Math.abs(g.myBalance)} currency={g.currency} />
              </span>
            }
            caption={g.myBalance > 0 ? t('home.owedToYou') : t('home.youOwe')}
          />
        )
      }
    />
  );

  if (gone) return <Goodbye />;

  const loaded = Boolean(groups);
  return (
    <Screen>
      <ScreenTitle center lead={t('common.tagline')}>
        {t('common.brand')}
      </ScreenTitle>

      {error && !groups ? (
        <ErrorView message={error} />
      ) : !groups ? (
        <Loading />
      ) : groups.length === 0 ? (
        <Welcome />
      ) : (
        (active.length > 0 || archived.length > 0) && (
          <Section title={active.length > 0 ? t('home.myGroups') : undefined} inset={68}>
            {active.map(groupRow)}
            {archived.length > 0 && (
              <>
                <Row
                  left={<Tile icon="archive" tone="gray" />}
                  title={<span className="hint">{t('home.archive', { count: archived.length })}</span>}
                  onClick={toggleArchive}
                  right={
                    <span className="chev">
                      <Icon name={archiveOpen ? 'down' : 'chev'} size={18} stroke={2.2} />
                    </span>
                  }
                />
                {archiveOpen && archived.map(groupRow)}
              </>
            )}
          </Section>
        )
      )}

      {loaded && <Settings />}

      {loaded && <DeleteData onDeleted={() => setGone(true)} />}

      <LegalLinks
        links={[
          { label: t('account.privacy'), onClick: () => navigate('/privacy') },
          { label: t('account.termsShort'), onClick: () => navigate('/terms') },
        ]}
        version={t('common.version', { version: __APP_VERSION__ })}
      />

      <MainButton text={t('home.createGroup')} onClick={() => navigate('/new')} />
    </Screen>
  );
}

const groupInitial = (name: string) => Array.from(name.trim())[0]?.toUpperCase() ?? '?';

const WELCOME_STEPS = [
  ['home.welcomeStep1Title', 'home.welcomeStep1Text'],
  ['home.welcomeStep2Title', 'home.welcomeStep2Text'],
  ['home.welcomeStep3Title', 'home.welcomeStep3Text'],
] as const;

/** First launch: how the app works in three steps, plus a ready-made example group to poke at. */
function Welcome() {
  const [busy, setBusy] = useState(false);
  const openExample = async () => {
    setBusy(true);
    try {
      const g = await api.createDemo();
      setGroup(g);
      navigate(`/g/${g.id}`);
    } catch (e) {
      await alertDialog((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <>
      <Steps
        title={t('home.welcomeTitle')}
        items={WELCOME_STEPS.map(([title, text]) => ({ title: t(title), text: t(text) }))}
      />
      <Button variant="tint" wide icon="users" loading={busy} onClick={() => void openExample()}>
        {t('home.seeExample')}
      </Button>
    </>
  );
}

/** «Настройки»: реквизиты (строка или форма) и уведомления. */
function Settings() {
  const [notify, setNotify] = useState<boolean>();
  const [info, setInfo] = useState<PaymentInfo>();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    api.me().then(
      (me) => setNotify(me.notify),
      () => {},
    );
    api.myPaymentInfo().then(setInfo, () => {});
  }, []);

  const toggle = async () => {
    const next = !notify;
    if (next && inTelegram && !(await requestWriteAccess())) {
      await alertDialog(t('home.notifyDenied'));
      return;
    }
    setNotify(next);
    await api.setNotify(next).catch(() => setNotify(!next));
  };

  const notifyRow = notify !== undefined && (
    <Row
      left={<Tile icon="bell" tone="solid-orange" size="s" />}
      title={t('home.notifyTitle')}
      onClick={toggle}
      right={<Switch on={notify} />}
    />
  );

  if (open && info)
    return (
      <>
        <PaymentForm
          title={t('payment.mySection')}
          footer={t('payment.myFooter')}
          initial={info}
          onCancel={() => setOpen(false)}
          onSave={async (next) => {
            const saved = await api.setMyPaymentInfo(next);
            setInfo(saved);
            setOpen(false);
            return saved;
          }}
        />
        {notifyRow && <Section inset={60}>{notifyRow}</Section>}
      </>
    );

  if (!info && notify === undefined) return null;
  return (
    <Section title={t('home.settings')} inset={60} footer={info ? t('payment.myFooter') : undefined}>
      {info && (
        <Row
          left={<Tile icon="card" tone="solid-blue" size="s" />}
          title={t('payment.mySection')}
          onClick={() => setOpen(true)}
          right={
            <span className="hint">
              {hasPaymentInfo(info) ? t('payment.mySummaryFilled') : t('payment.mySummaryEmpty')}
            </span>
          }
          chevron
        />
      )}
      {notifyRow}
    </Section>
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
      <Row
        tone="danger"
        className="center"
        title={t('account.deleteData')}
        onClick={busy ? undefined : () => void remove()}
      />
    </Section>
  );
}

function Goodbye() {
  return (
    <Screen>
      <EmptyState icon="check" tone="pos" title={t('account.goodbyeTitle')} hint={t('account.goodbyeText')}>
        {inTelegram && <MainButton text={t('account.goodbyeClose')} onClick={closeApp} />}
      </EmptyState>
    </Screen>
  );
}
