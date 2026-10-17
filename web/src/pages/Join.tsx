import { useEffect, useState } from 'react';
import { api, type InvitePreview } from '../api.ts';
import { t } from '../i18n.ts';
import { joinSource } from '../joinSource.ts';
import { askNotifyOnce } from '../notify.ts';
import { navigate } from '../router.ts';
import { alertDialog, BackButton, haptic, MainButton } from '../tg.tsx';
import { ErrorView, Loading, Row, Section } from '../ui.tsx';

export function Join({ code }: { code: string }) {
  const [invite, setInvite] = useState<InvitePreview>();
  const [error, setError] = useState<string>();
  const [claim, setClaim] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.invite(code).then(
      (inv) => {
        // Already in the group (e.g. opened from a notification): go straight there.
        if (inv.isMember) navigate(`/g/${inv.group.id}`, { replace: true });
        else setInvite(inv);
      },
      (e: Error) => setError(e.message),
    );
  }, [code]);

  const join = async () => {
    setSaving(true);
    try {
      const { groupId } = await api.join(code, claim ?? undefined, joinSource.value);
      haptic.success();
      navigate(`/g/${groupId}`, { replace: true });
      void askNotifyOnce();
    } catch (e) {
      setSaving(false);
      haptic.error();
      await alertDialog((e as Error).message);
    }
  };

  const back = <BackButton onClick={() => navigate('/', { replace: true })} />;
  if (error)
    return (
      <div className="page">
        {back}
        <ErrorView message={error} />
      </div>
    );
  if (!invite)
    return (
      <div className="page">
        {back}
        <Loading />
      </div>
    );

  const { group, unclaimed } = invite;
  return (
    <div className="page">
      {back}
      <header className="hero">
        <div className="hero-emoji">👋</div>
        <h1>{group.name}</h1>
        <p className="hint">{t('join.invited', { members: t('common.members', { count: group.membersCount }) })}</p>
      </header>

      {unclaimed.length > 0 && (
        <Section title={t('join.whoAreYou')} footer={t('join.whoFooter')}>
          {unclaimed.map((m) => (
            <Row
              key={m.id}
              onClick={() => setClaim(m.id)}
              left={<span className={`radio ${claim === m.id ? 'on' : ''}`} />}
              title={m.name}
            />
          ))}
          <Row
            onClick={() => setClaim(null)}
            left={<span className={`radio ${claim === null ? 'on' : ''}`} />}
            title={t('join.notInList')}
          />
        </Section>
      )}

      <MainButton text={t('join.join')} onClick={join} loading={saving} />
    </div>
  );
}
