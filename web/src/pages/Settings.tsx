import { useState } from 'react';
import { api, forgetGroup, type GroupDetail, type Member, setGroup, useGroup } from '../api.ts';
import { t } from '../i18n.ts';
import { navigate } from '../router.ts';
import { alertDialog, BackButton, confirmDialog, haptic, shareLink } from '../tg.tsx';
import { Avatar, ErrorView, Loading, Row, Section } from '../ui.tsx';
import { PaymentForm } from './PaymentForm.tsx';

export function Settings({ id }: { id: number }) {
  const { data: g, error } = useGroup(id);
  const back = <BackButton onClick={() => navigate(`/g/${id}`, { replace: true })} />;
  if (!g)
    return (
      <div className="page">
        {back}
        {error ? <ErrorView message={error} /> : <Loading />}
      </div>
    );
  return (
    <div className="page">
      {back}
      <SettingsView g={g} />
    </div>
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
    if (!(await confirmDialog(t('settings.confirmDeleteGroup', { name: g.name })))) return;
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

  const toggleArchive = async () => {
    if (!g.archived && !(await confirmDialog(t('settings.confirmArchive', { name: g.name })))) return;
    if (await run(() => (g.archived ? api.unarchiveGroup(g.id) : api.archiveGroup(g.id)))) {
      if (!g.archived) navigate('/', { replace: true });
    }
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

  return (
    <>
      <h2 className="page-title">{t('settings.title')}</h2>

      <Section title={t('settings.nameSection')}>
        <div className="row">
          <input className="field inline" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
          {name.trim() && name.trim() !== g.name && (
            <button type="button" className="small-btn" onClick={() => run(() => api.renameGroup(g.id, name.trim()))}>
              {t('common.save')}
            </button>
          )}
        </div>
      </Section>

      <Section title={t('settings.inviteSection')} footer={t('settings.inviteFooter')}>
        {g.inviteLink ? (
          <>
            <div className="row invite-link">{g.inviteLink}</div>
            <div className="row buttons">
              <button type="button" className="small-btn" onClick={copy}>
                {copied ? t('settings.copied') : t('settings.copy')}
              </button>
              <button
                type="button"
                className="small-btn primary"
                onClick={() => shareLink(g.inviteLink!, t('settings.shareText', { name: g.name }))}
              >
                {t('settings.share')}
              </button>
            </div>
          </>
        ) : (
          <div className="row hint">{t('settings.noLink', { code: g.inviteCode })}</div>
        )}
      </Section>

      <Section title={t('settings.membersSection', { count: g.members.length })} footer={t('settings.membersFooter')}>
        {g.members.map((m) => (
          <MemberRow key={m.id} g={g} m={m} />
        ))}
        <div className="row">
          <input
            className="field inline"
            placeholder={t('settings.newMemberPlaceholder')}
            value={newMember}
            maxLength={64}
            onChange={(e) => setNewMember(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addMember()}
          />
          <button type="button" className="small-btn" disabled={!newMember.trim()} onClick={addMember}>
            {t('common.add')}
          </button>
        </div>
      </Section>

      <Section title={t('settings.chatSection')} footer={g.chat ? t('settings.chatFooter') : undefined}>
        {g.chat ? (
          <Row
            title={t('settings.chatLinked', { title: g.chat.title })}
            right={
              <button type="button" className="small-btn" onClick={() => void unlinkChat()}>
                {t('settings.chatUnlink')}
              </button>
            }
          />
        ) : (
          <div className="row hint">{t('settings.chatNone')}</div>
        )}
      </Section>

      <Section title={t('settings.exportSection')} footer={t('settings.exportFooter')}>
        <Row
          title={exporting ? t('settings.exporting') : t('settings.exportCsv')}
          onClick={exporting ? undefined : exportCsv}
        />
      </Section>

      <Section footer={t('settings.archiveFooter')}>
        <Row title={g.archived ? t('settings.unarchiveGroup') : t('settings.archiveGroup')} onClick={toggleArchive} />
      </Section>

      <button type="button" className="danger-btn" onClick={leaveGroup}>
        {t('settings.leaveGroup')}
      </button>

      {g.isOwner && (
        <button type="button" className="danger-btn" onClick={deleteGroup}>
          {t('settings.deleteGroup')}
        </button>
      )}
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
        <div className="row">
          <input
            className="field inline"
            value={name}
            maxLength={64}
            // biome-ignore lint/a11y/noAutofocus: поле появляется по нажатию «изменить» — фокус нужен сразу
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          <button type="button" className="small-btn" onClick={save}>
            {t('common.done')}
          </button>
        </div>
        {m.userId === null && (
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

  return (
    <Row
      left={<Avatar member={m} />}
      title={m.id === g.meId ? t('common.youParen', { name: m.name }) : m.name}
      subtitle={m.userId ? (m.username ? `@${m.username}` : t('settings.telegram')) : t('settings.noTelegram')}
      onClick={() => setEditing(true)}
      right={m.userId === null ? undefined : <span className="hint">✎</span>}
      action={
        m.userId === null ? (
          <button type="button" className="icon-btn" aria-label={t('common.delete')} onClick={() => void remove()}>
            ✕
          </button>
        ) : undefined
      }
    />
  );
}
