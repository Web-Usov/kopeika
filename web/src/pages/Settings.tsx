import { useState } from 'react';
import { api, forgetGroup, type GroupDetail, type Member, setGroup, useGroup } from '../api.ts';
import { navigate } from '../router.ts';
import { alertDialog, BackButton, confirmDialog, haptic, shareLink } from '../tg.tsx';
import { Avatar, ErrorView, Loading, Row, Section } from '../ui.tsx';

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
    if (!(await confirmDialog(`Удалить группу «${g.name}» вместе со всеми тратами? Это нельзя отменить.`))) return;
    try {
      await api.deleteGroup(g.id);
      forgetGroup(g.id);
      navigate('/', { replace: true });
    } catch (e) {
      await alertDialog((e as Error).message);
    }
  };

  return (
    <>
      <h2 className="page-title">Настройки группы</h2>

      <Section title="Название">
        <div className="row">
          <input className="field inline" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
          {name.trim() && name.trim() !== g.name && (
            <button type="button" className="small-btn" onClick={() => run(() => api.renameGroup(g.id, name.trim()))}>
              Сохранить
            </button>
          )}
        </div>
      </Section>

      <Section
        title="Приглашение"
        footer="Отправьте ссылку в чат с друзьями. По ней откроется Копейка, и человек сможет вступить в группу."
      >
        {g.inviteLink ? (
          <>
            <div className="row invite-link">{g.inviteLink}</div>
            <div className="row buttons">
              <button type="button" className="small-btn" onClick={copy}>
                {copied ? 'Скопировано ✓' : 'Скопировать'}
              </button>
              <button
                type="button"
                className="small-btn primary"
                onClick={() => shareLink(g.inviteLink!, `Присоединяйся к группе «${g.name}» в Копейке`)}
              >
                Поделиться
              </button>
            </div>
          </>
        ) : (
          <div className="row hint">
            Ссылка появится, когда на сервере будут заданы BOT_TOKEN и APP_SHORT_NAME. Код: {g.inviteCode}
          </div>
        )}
      </Section>

      <Section
        title={`Участники · ${g.members.length}`}
        footer="Участника без Telegram можно удалить, если у него нет трат."
      >
        {g.members.map((m) => (
          <MemberRow key={m.id} g={g} m={m} />
        ))}
        <div className="row">
          <input
            className="field inline"
            placeholder="Имя нового участника"
            value={newMember}
            maxLength={64}
            onChange={(e) => setNewMember(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addMember()}
          />
          <button type="button" className="small-btn" disabled={!newMember.trim()} onClick={addMember}>
            Добавить
          </button>
        </div>
      </Section>

      {g.isOwner && (
        <button type="button" className="danger-btn" onClick={deleteGroup}>
          Удалить группу
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
          Готово
        </button>
      </div>
    );
  }

  const remove = async () => {
    if (await confirmDialog(`Удалить участника «${m.name}»?`)) await run(() => api.deleteMember(g.id, m.id));
  };

  return (
    <Row
      left={<Avatar member={m} />}
      title={m.id === g.meId ? `${m.name} (вы)` : m.name}
      subtitle={m.userId ? (m.username ? `@${m.username}` : 'Telegram') : 'без Telegram'}
      onClick={() => setEditing(true)}
      right={m.userId === null ? undefined : <span className="hint">✎</span>}
      action={
        m.userId === null ? (
          <button type="button" className="icon-btn" aria-label="Удалить" onClick={() => void remove()}>
            ✕
          </button>
        ) : undefined
      }
    />
  );
}
