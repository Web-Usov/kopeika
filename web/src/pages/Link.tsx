import { useEffect, useState } from 'react';
import { api, type ChatLinkPreview, setGroup, useGroups } from '../api.ts';
import { t } from '../i18n.ts';
import { navigate } from '../router.ts';
import { alertDialog, BackButton, haptic, MainButton } from '../tg.tsx';
import { Avatar, AvatarAdd, Emblem, ErrorView, Intro, Loading, Radio, Row, Screen, Section } from '../ui.tsx';

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
      <Screen>
        {back}
        <ErrorView message={failure} />
      </Screen>
    );
  if (!preview || !groups)
    return (
      <Screen>
        {back}
        <Loading />
      </Screen>
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
    <Screen>
      {back}
      <Intro
        emblem={<Emblem icon="chat" />}
        title={t('link.title', { chat: preview.chatTitle })}
        lead={t('link.hint')}
      />

      <Section
        title={t('link.pickGroup')}
        footer={preview.replaces ? t('link.willReplace', { name: preview.replaces.name }) : undefined}
        inset={64}
      >
        {active.length === 0 && <Row title={<span className="hint">{t('link.noGroups')}</span>} />}
        {active.map((g) => (
          <Row
            key={g.id}
            onClick={() => setPicked(g.id)}
            left={<Avatar member={{ id: g.id - 1, name: g.name, photoUrl: null }} />}
            title={g.name}
            subtitle={t('common.members', { count: g.membersCount })}
            right={<Radio on={picked === g.id} />}
          />
        ))}
        <Row
          tone="link"
          left={<AvatarAdd tint />}
          title={t('link.createNew')}
          onClick={() => navigate(`/new?link=${encodeURIComponent(token)}`)}
        />
      </Section>

      <MainButton text={t('link.attach')} onClick={attach} loading={saving} disabled={picked === null} />
    </Screen>
  );
}
