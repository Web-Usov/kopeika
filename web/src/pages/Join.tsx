import { useEffect, useState } from 'react';
import { api, type InvitePreview } from '../api.ts';
import { t } from '../i18n.ts';
import { joinSource } from '../joinSource.ts';
import { askNotifyOnce } from '../notify.ts';
import { navigate } from '../router.ts';
import { alertDialog, BackButton, haptic, MainButton } from '../tg.tsx';
import {
  Avatar,
  AvatarAdd,
  AvatarStack,
  Emblem,
  ErrorView,
  Intro,
  Loading,
  Radio,
  Row,
  Screen,
  Section,
} from '../ui.tsx';

/** `to`: where a member lands (the bot's «Open the summary» button points at the summary). */
export function Join({ code, to }: { code: string; to?: 'summary' }) {
  const [invite, setInvite] = useState<InvitePreview>();
  const [error, setError] = useState<string>();
  const [claim, setClaim] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.invite(code).then(
      (inv) => {
        // Already in the group (e.g. opened from a notification): go straight there.
        if (inv.isMember) navigate(`/g/${inv.group.id}${to === 'summary' ? '/summary' : ''}`, { replace: true });
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
      <Screen>
        {back}
        <ErrorView message={error} hint={t('join.invalidHint')} />
      </Screen>
    );
  if (!invite)
    return (
      <Screen>
        {back}
        <Loading />
      </Screen>
    );

  const { group, unclaimed, members } = invite;
  const [a, b] = members;
  const whoText =
    group.membersCount > 2 && a && b
      ? t('join.withMore', { a: a.name, b: b.name, count: group.membersCount - 2 })
      : a && b
        ? t('join.withTwo', { a: a.name, b: b.name })
        : (a?.name ?? '');
  return (
    <Screen>
      {back}
      <Intro emblem={<Emblem icon="userplus" />} title={group.name} lead={t('join.invited')}>
        <div className="intro-who">
          <AvatarStack members={members.slice(0, 4).map((m) => ({ ...m, photoUrl: null }))} />
          <span>{whoText}</span>
        </div>
      </Intro>

      {unclaimed.length > 0 && (
        <Section title={t('join.whoAreYou')} footer={t('join.whoFooter')} inset={64}>
          {unclaimed.map((m) => (
            <Row
              key={m.id}
              onClick={() => setClaim(m.id)}
              left={<Avatar member={{ id: m.id, name: m.name, photoUrl: null }} />}
              title={m.name}
              subtitle={t('settings.noTelegram')}
              right={<Radio on={claim === m.id} />}
            />
          ))}
          <Row
            onClick={() => setClaim(null)}
            left={<AvatarAdd />}
            title={t('join.notInList')}
            subtitle={t('join.notInListHint')}
            right={<Radio on={claim === null} />}
          />
        </Section>
      )}

      <MainButton text={t('join.join')} onClick={join} loading={saving} />
    </Screen>
  );
}
