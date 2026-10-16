import { useState } from 'react';
import { CURRENCIES } from '../../../shared/money.ts';
import { api, setGroup } from '../api.ts';
import { navigate } from '../router.ts';
import { askNotifyOnce } from '../notify.ts';
import { BackButton, MainButton, alertDialog, haptic } from '../tg.tsx';
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
      <h2 className="page-title">Новая группа</h2>

      <Section title="Название">
        <input
          className="field"
          placeholder="Поездка в Грузию"
          value={name}
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
        />
      </Section>

      <Section title="Валюта">
        <select className="field" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Section>

      <Section
        title="Участники"
        footer="Друзья из Telegram смогут присоединиться по ссылке-приглашению и выбрать себя из этого списка. Тех, у кого нет Telegram, просто впишите по имени."
      >
        <div className="row">
          <span className="row-main">
            <span className="row-title">Вы</span>
          </span>
        </div>
        {others.map((n, i) => (
          <div className="row" key={i}>
            <input
              className="field inline"
              placeholder="Имя участника"
              value={n}
              maxLength={64}
              autoFocus={i === others.length - 1}
              onChange={(e) => setOthers(others.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <button className="icon-btn" onClick={() => setOthers(others.filter((_, j) => j !== i))} aria-label="Убрать">
              ✕
            </button>
          </div>
        ))}
        <button className="row clickable link" onClick={() => setOthers([...others, ''])}>
          + Добавить участника
        </button>
      </Section>

      <MainButton text="Создать группу" onClick={create} disabled={!name.trim()} loading={saving} />
    </div>
  );
}
