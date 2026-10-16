import { useEffect, useState } from 'react';
import { api, type ChatLinkPreview, setGroup, useGroups } from '../api.ts';
import { t } from '../i18n.ts';
import { navigate } from '../router.ts';
import { alertDialog, BackButton, haptic, MainButton } from '../tg.tsx';
import { ErrorView, Loading, Row, Section } from '../ui.tsx';

/** Opened from the button the bot posts in a group chat: pick the Kopeika group to attach that chat to. */
export function Link({ token }: { token: string }) {
  const [preview, setPreview] = useState<ChatLinkPreview>();
  const [error, setError] = useState<string>();
  const { data: groups, error: groupsError } = useGroups();
  const [picked, setPicked] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.chatLink(token).then(setPreview, (e: Error) => setError(e.message));
  }, [token]);

  const back = <BackButton onClick={() => navigate('/', { replace: true })} />;
  const failure = error ?? groupsError;
  if (failure)
    return (
      <div className="page">
        {back}
        <ErrorView message={failure} />
      </div>
    );
  if (!preview || !groups)
    return (
      <div className="page">
        {back}
        <Loading />
      </div>
    );

  const active = groups.filter((g) => !g.archived);
  const attach = async () => {
    if (picked === null) return;
    setSaving(true);
    try {
      const g = await api.attachChat(token, picked);
      setGroup(g);
      haptic.success();
      navigate(`/g/${g.id}`, { replace: true });
    } catch (e) {
      setSaving(false);
      haptic.error();
      await alertDialog((e as Error).message);
    }
  };

  return (
    <div className="page">
      {back}
      <header className="hero">
        <div className="hero-emoji">💬</div>
        <h1>{t('link.title', { chat: preview.chatTitle })}</h1>
        <p className="hint">{t('link.hint')}</p>
      </header>

      <Section
        title={t('link.pickGroup')}
        footer={preview.replaces ? t('link.willReplace', { name: preview.replaces.name }) : undefined}
      >
        {active.length === 0 && <div className="row hint">{t('link.noGroups')}</div>}
        {active.map((g) => (
          <Row
            key={g.id}
            onClick={() => setPicked(g.id)}
            left={<span className={`radio ${picked === g.id ? 'on' : ''}`} />}
            title={g.name}
            subtitle={t('common.members', { count: g.membersCount })}
          />
        ))}
        <Row title={t('link.createNew')} onClick={() => navigate(`/new?link=${encodeURIComponent(token)}`)} />
      </Section>

      <MainButton text={t('link.attach')} onClick={attach} loading={saving} disabled={picked === null} />
    </div>
  );
}
