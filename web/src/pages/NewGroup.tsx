import { useState } from 'react';
import { CURRENCIES } from '../../../shared/money.ts';
import { api, setGroup } from '../api.ts';
import { t } from '../i18n.ts';
import { askNotifyOnce } from '../notify.ts';
import { navigate } from '../router.ts';
import { alertDialog, BackButton, haptic, MainButton } from '../tg.tsx';
import { Section } from '../ui.tsx';

export function NewGroup() {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('RUB');
  const [others, setOthers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const create = async () => {
    setSaving(true);
    try {
      const g = await api.createGroup({
        name: name.trim(),
        currency,
        memberNames: others.map((n) => n.trim()).filter(Boolean),
      });
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
    <div className="page">
      <BackButton onClick={() => navigate('/', { replace: true })} />
      <h2 className="page-title">{t('newGroup.title')}</h2>

      <Section title={t('newGroup.nameSection')}>
        <input
          className="field"
          placeholder={t('newGroup.namePlaceholder')}
          value={name}
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
        />
      </Section>

      <Section title={t('newGroup.currencySection')}>
        <select className="field" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Section>

      <Section title={t('newGroup.membersSection')} footer={t('newGroup.membersFooter')}>
        <div className="row">
          <span className="row-main">
            <span className="row-title">{t('common.you')}</span>
          </span>
        </div>
        {others.map((n, i) => (
          <div className="row" key={i}>
            <input
              className="field inline"
              placeholder={t('newGroup.memberPlaceholder')}
              value={n}
              maxLength={64}
              // biome-ignore lint/a11y/noAutofocus: фокус на только что добавленном поле участника — так задумано
              autoFocus={i === others.length - 1}
              onChange={(e) => setOthers(others.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <button
              type="button"
              className="icon-btn"
              onClick={() => setOthers(others.filter((_, j) => j !== i))}
              aria-label={t('common.remove')}
            >
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="row clickable link" onClick={() => setOthers([...others, ''])}>
          {t('newGroup.addMember')}
        </button>
      </Section>

      <MainButton text={t('newGroup.create')} onClick={create} disabled={!name.trim()} loading={saving} />
    </div>
  );
}
