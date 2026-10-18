import { useEffect, useState } from 'react';
import {
  api,
  type ChatFeed,
  forgetGroup,
  type GroupDetail,
  type Member,
  type Recurring,
  setGroup,
  useGroup,
} from '../api.ts';
import { finishTrip } from '../finish.ts';
import { t } from '../i18n.ts';
import { Icon } from '../icons.tsx';
import { scheduleText, shortDate } from '../recurring.ts';
import { navigate } from '../router.ts';
import { alertDialog, BackButton, canRequestChat, confirmDialog, haptic, requestChat, shareLink } from '../tg.tsx';
import {
  Avatar,
  AvatarAdd,
  BigField,
  Button,
  DemoNote,
  ErrorView,
  IconButton,
  InviteCard,
  Loading,
  Money,
  Row,
  Screen,
  ScreenTitle,
  Section,
  Segmented,
  Switch,
  Tile,
} from '../ui.tsx';
import { PaymentForm } from './PaymentForm.tsx';

const FEED_FOOTER = {
  off: 'settings.feedFooterOff',
  each: 'settings.feedFooterEach',
  daily: 'settings.feedFooterDaily',
} as const;

export function Settings({ id }: { id: number }) {
  const { data: g, error } = useGroup(id);
  const back = <BackButton onClick={() => navigate(`/g/${id}`, { replace: true })} />;
  if (!g)
    return (
      <Screen>
        {back}
        {error ? <ErrorView message={error} /> : <Loading />}
      </Screen>
    );
  return (
    <Screen>
      {back}
      <SettingsView g={g} />
    </Screen>
  );
}

async function run(action: () => Promise<GroupDetail>) {
  try {
    setGroup(await action());
    haptic.success();
    return true;
  } catch (e) {
    haptic.error();
    await alertDialog((e as Error).message);
    return false;
  }
}

function SettingsView({ g }: { g: GroupDetail }) {
  const [name, setName] = useState(g.name);
  const [newMember, setNewMember] = useState('');
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  const copy = async () => {
    const text = g.inviteLink ?? g.inviteCode;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      haptic.success();
      setTimeout(() => setCopied(false), 2000);
    } catch {
      await alertDialog(text);
    }
  };

  const addMember = async () => {
    const n = newMember.trim();
    if (n && (await run(() => api.addMember(g.id, n)))) setNewMember('');
  };

  const deleteGroup = async () => {
    if (
      !(await confirmDialog(t(g.isDemo ? 'group.demoConfirmDelete' : 'settings.confirmDeleteGroup', { name: g.name })))
    )
      return;
    try {
      await api.deleteGroup(g.id);
      forgetGroup(g.id);
      navigate('/', { replace: true });
    } catch (e) {
      await alertDialog((e as Error).message);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await api.exportGroup(g.id);
      haptic.success();
      await alertDialog(t('settings.exportSent'));
    } catch (e) {
      haptic.error();
      await alertDialog((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const unlinkChat = async () => {
    if (!g.chat || !(await confirmDialog(t('settings.confirmUnlinkChat', { title: g.chat.title })))) return;
    await run(() => api.unlinkChat(g.id));
  };

  // The picker hands the chat to the bot, not to the app: after it closes, reload the group until the link shows up
  // (and once more when the app regains focus, in case the bot was slow).
  const [waitingChat, setWaitingChat] = useState(false);
  const pickChat = async () => {
    setWaitingChat(true);
    try {
      const { id } = await api.prepareChatRequest(g.id);
      if (!(await requestChat(id))) return;
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        if ((await api.reloadGroup(g.id)).chat) {
          haptic.success();
          return;
        }
      }
      await alertDialog(t('settings.chatPickLater'));
    } catch (e) {
      haptic.error();
      await alertDialog((e as Error).message);
    } finally {
      setWaitingChat(false);
    }
  };
  useEffect(() => {
    const onFocus = () => {
      if (!g.chat) void api.reloadGroup(g.id).catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [g.id, g.chat]);

  const toggleArchive = async () => {
    if (!g.archived && !(await confirmDialog(t('settings.confirmArchive', { name: g.name })))) return;
    if (await run(() => (g.archived ? api.unarchiveGroup(g.id) : api.archiveGroup(g.id)))) {
      if (!g.archived) navigate('/', { replace: true });
    }
  };

  const finish = async () => {
    const unsettled = g.members.some((m) => m.balance !== 0);
    const message = t(unsettled ? 'settings.confirmFinishUnsettled' : 'settings.confirmFinish', { name: g.name });
    if (await confirmDialog(message)) await finishTrip(g);
  };

  const rotateInvite = async () => {
    if (await confirmDialog(t('settings.confirmRotateInvite'))) await run(() => api.rotateInvite(g.id));
  };

  const leaveGroup = async () => {
    if (!(await confirmDialog(t('settings.confirmLeave', { name: g.name })))) return;
    try {
      await api.leaveGroup(g.id);
      forgetGroup(g.id);
      navigate('/', { replace: true });
    } catch (e) {
      await alertDialog((e as Error).message);
    }
  };

  const nameDirty = name.trim() !== '' && name.trim() !== g.name;
  const rename = () => run(() => api.renameGroup(g.id, name.trim()));
  const chatFooter = [
    g.chat ? t(FEED_FOOTER[g.chat.feed]) : t('settings.chatNone'),
    t('settings.autoRemindFooter'),
  ].join(' ');
  const groupFooter = g.isDemo ? undefined : t(g.archived ? 'settings.groupFooterShort' : 'settings.groupFooter');
  const inviteFooter = g.isOwner
    ? `${t('settings.inviteFooter')} ${t('settings.inviteRotateNote')}`
    : t('settings.inviteFooter');

  return (
    <>
      <ScreenTitle>{t('settings.title')}</ScreenTitle>

      {g.isDemo && (
        <DemoNote
          text={t('group.demoBanner')}
          actionLabel={t('group.demoDelete')}
          onAction={() => void deleteGroup()}
        />
      )}

      <Section>
        <BigField
          label={t('settings.nameLabel')}
          value={name}
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && nameDirty && void rename()}
        />
        {nameDirty && (
          <div className="save-row">
            <Button variant="tint" wide onClick={() => void rename()}>
              {t('common.save')}
            </Button>
          </div>
        )}
      </Section>

      {!g.isDemo && (
        <Section title={t('settings.inviteSection')} footer={inviteFooter}>
          {g.inviteLink ? (
            <InviteCard
              link={g.inviteLink}
              copyLabel={copied ? t('settings.copied') : t('settings.copy')}
              shareLabel={t('settings.share')}
              onCopy={() => void copy()}
              onShare={() => shareLink(g.inviteLink!, t('settings.shareText', { name: g.name }))}
              rotateLabel={g.isOwner ? t('settings.rotateInvite') : undefined}
              onRotate={() => void rotateInvite()}
            />
          ) : (
            <>
              <Row
                className="wrap"
                title={<span className="hint">{t('settings.noLink', { code: g.inviteCode })}</span>}
              />
              {g.isOwner && (
                <Row
                  tone="link"
                  left={<Icon name="repeat" size={22} stroke={1.9} />}
                  title={t('settings.rotateInvite')}
                  onClick={() => void rotateInvite()}
                />
              )}
            </>
          )}
        </Section>
      )}

      <Section
        title={t('settings.membersSection', { count: g.members.length })}
        footer={g.isDemo ? t('settings.demoMembersFooter') : t('settings.membersFooter')}
        inset={64}
      >
        {g.members.map((m) => (
          <MemberRow key={m.id} g={g} m={m} />
        ))}
        <Row
          left={<AvatarAdd />}
          title={
            <input
              className="row-input"
              aria-label={t('settings.newMemberPlaceholder')}
              placeholder={t('settings.newMemberPlaceholder')}
              value={newMember}
              maxLength={64}
              onChange={(e) => setNewMember(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addMember()}
            />
          }
          right={
            <Button variant="tint" size="s" disabled={!newMember.trim()} onClick={addMember}>
              {t('common.add')}
            </Button>
          }
        />
      </Section>

      {!g.isDemo && (
        <Section title={t('settings.chatRemindSection')} footer={chatFooter} inset={60}>
          {g.chat ? (
            <>
              <Row
                left={<Tile icon="chat" tone="solid-blue" size="s" />}
                title={t('settings.chatLinked', { title: g.chat.title })}
                right={
                  <Button variant="fill" size="s" onClick={() => void unlinkChat()}>
                    {t('settings.chatUnlink')}
                  </Button>
                }
              />
              <Segmented<ChatFeed>
                value={g.chat.feed}
                options={[
                  { value: 'off', label: t('settings.feedOff') },
                  { value: 'each', label: t('settings.feedEach') },
                  { value: 'daily', label: t('settings.feedDaily') },
                ]}
                onChange={(feed) => void run(() => api.setChatFeed(g.id, feed))}
              />
            </>
          ) : (
            <Row
              left={<Tile icon="chat" tone="solid-blue" size="s" />}
              title={t('settings.chatPickTitle')}
              right={
                <span className="hint">
                  {waitingChat ? t('settings.chatPickWaiting') : t('settings.chatStatusNone')}
                </span>
              }
              chevron={canRequestChat()}
              onClick={canRequestChat() && !waitingChat ? () => void pickChat() : undefined}
            />
          )}
          <Row
            left={<Tile icon="bell" tone="solid-orange" size="s" />}
            wrap
            title={t('settings.autoRemindTitle')}
            onClick={() => void run(() => api.setAutoRemind(g.id, !g.autoRemind))}
            right={<Switch on={g.autoRemind} />}
          />
        </Section>
      )}

      {!g.isDemo && <RecurringSection g={g} />}

      <Section footer={groupFooter} inset={60}>
        <Row
          left={<Tile icon="download" tone="solid-green" size="s" />}
          title={exporting ? t('settings.exporting') : t('settings.exportCsv')}
          onClick={exporting ? undefined : exportCsv}
          chevron
        />
        {!g.archived && !g.isDemo && (
          <Row
            left={<Tile icon="flag" tone="solid-purple" size="s" />}
            title={t('settings.finishTrip')}
            onClick={finish}
            chevron
          />
        )}
        <Row
          left={<Tile icon="archive" tone="solid-gray" size="s" />}
          title={g.archived ? t('settings.unarchiveGroup') : t('settings.archiveGroup')}
          onClick={toggleArchive}
          chevron
        />
      </Section>

      <Section inset={60}>
        <Row
          tone="danger"
          left={<Tile icon="logout" tone="solid-red" size="s" />}
          title={t('settings.leaveGroup')}
          onClick={leaveGroup}
        />
        {g.isOwner && (
          <Row
            tone="danger"
            left={<Tile icon="trash" tone="solid-red" size="s" />}
            title={g.isDemo ? t('settings.deleteDemo') : t('settings.deleteGroup')}
            onClick={deleteGroup}
          />
        )}
      </Section>
    </>
  );
}

function MemberRow({ g, m }: { g: GroupDetail; m: Member }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(m.name);

  if (editing) {
    const save = async () => {
      const n = name.trim();
      if (n && n !== m.name && !(await run(() => api.renameMember(g.id, m.id, n)))) return;
      setEditing(false);
    };
    return (
      <>
        <Row
          left={<Avatar member={m} />}
          title={
            <input
              className="row-input"
              aria-label={t('settings.nameLabel')}
              value={name}
              maxLength={64}
              // biome-ignore lint/a11y/noAutofocus: поле появляется по нажатию «изменить» — фокус нужен сразу
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
          }
          right={
            <Button variant="tint" size="s" onClick={save}>
              {t('common.done')}
            </Button>
          }
        />
        {!m.hasTelegram && (
          <PaymentForm
            bare
            initial={m.paymentInfo}
            onSave={async (next) => {
              const updated = await api.setMemberPaymentInfo(g.id, m.id, next);
              setGroup(updated);
              return updated.members.find((x) => x.id === m.id)?.paymentInfo ?? {};
            }}
          />
        )}
      </>
    );
  }

  const remove = async () => {
    if (await confirmDialog(t('settings.confirmDeleteMember', { name: m.name })))
      await run(() => api.deleteMember(g.id, m.id));
  };

  const kick = async () => {
    if (await confirmDialog(t('settings.confirmRemoveMember', { name: m.name })))
      await run(() => api.removeMember(g.id, m.id));
  };

  const isMe = m.id === g.meId;
  return (
    <Row
      left={<Avatar member={m} />}
      title={isMe ? t('common.youParen', { name: m.name }) : m.name}
      subtitle={m.hasTelegram ? (m.username ? `@${m.username}` : t('settings.telegram')) : t('settings.noTelegram')}
      onClick={() => setEditing(true)}
      action={
        !m.hasTelegram ? (
          <IconButton icon="x" variant="mute" label={t('common.delete')} onClick={() => void remove()} />
        ) : g.isOwner && !g.isDemo && !isMe ? (
          <IconButton icon="x" variant="mute" label={t('settings.removeMember')} onClick={() => void kick()} />
        ) : isMe ? (
          <IconButton icon="pencil" variant="mute" label={t('settings.editName')} onClick={() => setEditing(true)} />
        ) : undefined
      }
    />
  );
}

function RecurringSection({ g }: { g: GroupDetail }) {
  const [items, setItems] = useState<Recurring[]>();
  useEffect(() => {
    api
      .recurring(g.id)
      .then(setItems)
      .catch(() => setItems([]));
  }, [g.id]);
  if (!items) return null;

  const toggle = async (r: Recurring) => {
    try {
      const updated = await api.setRecurringActive(g.id, r.id, !r.active);
      setItems((list) => list?.map((x) => (x.id === r.id ? updated : x)));
      haptic.success();
    } catch (e) {
      haptic.error();
      await alertDialog((e as Error).message);
    }
  };

  const remove = async (r: Recurring) => {
    if (!(await confirmDialog(t('recurring.confirmDelete', { title: r.title })))) return;
    try {
      await api.deleteRecurring(g.id, r.id);
      setItems((list) => list?.filter((x) => x.id !== r.id));
    } catch (e) {
      await alertDialog((e as Error).message);
    }
  };

  return (
    <Section title={t('recurring.section')} footer={items.length > 0 ? t('recurring.footer') : undefined} inset={60}>
      {items.length === 0 && (
        <Row
          className="wrap"
          left={<Tile icon="repeat" tone="solid-gray" size="s" />}
          title={<span className="hint">{t('recurring.empty')}</span>}
        />
      )}
      {items.map((r) => (
        <Row
          key={r.id}
          className="wrap"
          left={<Tile icon="repeat" tone="solid-gray" size="s" />}
          title={r.title}
          subtitle={
            <>
              <Money value={r.amount} currency={g.currency} /> · {scheduleText(r.period, r.day)}
              <br />
              {r.active ? t('recurring.next', { date: shortDate(r.nextDate) }) : t('recurring.paused')}
            </>
          }
          right={
            <>
              <Button variant="fill" size="s" onClick={() => void toggle(r)}>
                {r.active ? t('recurring.pause') : t('recurring.resume')}
              </Button>
              <IconButton icon="x" variant="mute" label={t('common.delete')} onClick={() => void remove(r)} />
            </>
          }
        />
      ))}
    </Section>
  );
}
