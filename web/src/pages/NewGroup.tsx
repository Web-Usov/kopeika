import { useEffect, useState } from 'react';
import { CURRENCIES } from '../../../shared/money.ts';
import { api, setGroup } from '../api.ts';
import { t } from '../i18n.ts';
import { askNotifyOnce } from '../notify.ts';
import { navigate } from '../router.ts';
import { alertDialog, BackButton, haptic, MainButton } from '../tg.tsx';
import { Avatar, AvatarAdd, BigField, currencyLabel, IconButton, Row, Screen, ScreenTitle, Section } from '../ui.tsx';

/** `linkToken`: opened from the chat link screen; the new group gets that chat attached right away. */
export function NewGroup({ linkToken }: { linkToken?: string | null }) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('RUB');
  const [others, setOthers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [myName, setMyName] = useState<string>();

  useEffect(() => {
    api.me().then(
      (me) => setMyName(me.name),
      () => {},
    );
  }, []);

  const create = async () => {
    setSaving(true);
    try {
      const created = await api.createGroup({
        name: name.trim(),
        currency,
        memberNames: others.map((n) => n.trim()).filter(Boolean),
      });
      let g = created;
      if (linkToken) {
        // The group already exists; if linking fails (token expired), the user can retry from the chat.
        g = await api.attachChat(linkToken, created.id).catch(async (e: Error) => {
          await alertDialog(e.message);
          return created;
        });
      }
      setGroup(g);
      haptic.success();
      navigate(`/g/${g.id}`, { replace: true });
      void askNotifyOnce();
    } catch (e) {
      setSaving(false);
      haptic.error();
      await alertDialog((e as Error).message);
    }
  };

  return (
    <Screen>
      <BackButton onClick={() => navigate(linkToken ? `/link/${linkToken}` : '/', { replace: true })} />
      <ScreenTitle>{t('newGroup.title')}</ScreenTitle>

      <Section>
        <BigField
          label={t('newGroup.nameSection')}
          placeholder={t('newGroup.namePlaceholder')}
          value={name}
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
        />
        <Row
          title={t('newGroup.currencySection')}
          right={<span className="pick-value muted">{currencyLabel(currency)}</span>}
          chevron
          native={
            <select
              className="pick-native"
              aria-label={t('newGroup.currencySection')}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          }
        />
      </Section>

      <Section title={t('newGroup.membersSection')} footer={t('newGroup.membersFooter')} inset={64}>
        <Row
          left={<Avatar member={{ id: 0, name: myName ?? t('common.you'), photoUrl: null }} />}
          title={t('common.you')}
          subtitle={t('settings.telegram')}
        />
        {others.map((n, i) => (
          <Row
            key={i}
            left={n.trim() ? <Avatar member={{ id: i + 1, name: n.trim(), photoUrl: null }} /> : <AvatarAdd />}
            title={
              <input
                className="row-input"
                aria-label={t('newGroup.memberPlaceholder')}
                placeholder={t('newGroup.memberPlaceholder')}
                value={n}
                maxLength={64}
                // biome-ignore lint/a11y/noAutofocus: фокус на только что добавленном поле участника — так задумано
                autoFocus={i === others.length - 1}
                onChange={(e) => setOthers(others.map((x, j) => (j === i ? e.target.value : x)))}
              />
            }
            right={
              <IconButton
                icon="x"
                variant="mute"
                label={t('common.remove')}
                onClick={() => setOthers(others.filter((_, j) => j !== i))}
              />
            }
          />
        ))}
        <Row
          tone="link"
          left={<AvatarAdd tint />}
          title={t('newGroup.addMember')}
          onClick={() => setOthers([...others, ''])}
        />
      </Section>

      <MainButton text={t('newGroup.create')} onClick={create} disabled={!name.trim()} loading={saving} />
    </Screen>
  );
}
