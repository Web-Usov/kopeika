import { useEffect, useState } from 'react';
import { api, type InvitePreview } from '../api.ts';
import { askNotifyOnce } from '../notify.ts';
import { navigate } from '../router.ts';
import { alertDialog, BackButton, haptic, MainButton } from '../tg.tsx';
import { ErrorView, Loading, plural, Row, Section } from '../ui.tsx';

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
      const { groupId } = await api.join(code, claim ?? undefined);
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
        <p className="hint">
          Вас пригласили в группу · {group.membersCount}{' '}
          {plural(group.membersCount, 'участник', 'участника', 'участников')}
        </p>
      </header>

      {unclaimed.length > 0 && (
        <Section
          title="Кто вы в этой группе?"
          footer="Если вас уже добавили по имени, выберите себя: все траты с вашим участием останутся на месте."
        >
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
            title="Меня нет в списке"
          />
        </Section>
      )}

      <MainButton text="Присоединиться" onClick={join} loading={saving} />
    </div>
  );
}
