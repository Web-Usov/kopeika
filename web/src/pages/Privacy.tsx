import { policies } from '../../../shared/privacy.ts';
import { lang } from '../i18n.ts';
import { navigate } from '../router.ts';
import { BackButton } from '../tg.tsx';

export function Privacy() {
  const p = policies[lang];
  return (
    <div className="page policy">
      <BackButton onClick={() => navigate('/', { replace: true })} />
      <h1 className="page-title">{p.title}</h1>
      <p className="hint small">{p.updated}</p>
      <p>{p.intro}</p>
      {p.sections.map((s) => (
        <section key={s.heading}>
          <h2>{s.heading}</h2>
          {s.paragraphs?.map((x) => (
            <p key={x}>{x}</p>
          ))}
          {s.items && (
            <ul>
              {s.items.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
