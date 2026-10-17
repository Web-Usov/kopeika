import { useEffect, useState } from 'react';
import { type Policy, policy, type ReceiptsProvider } from '../../../shared/privacy.ts';
import { api } from '../api.ts';
import { lang } from '../i18n.ts';
import { navigate } from '../router.ts';
import { BackButton } from '../tg.tsx';
import { ErrorView, Loading } from '../ui.tsx';

/** The text names the receipt provider the server uses, so it waits for /me. */
export function Privacy() {
  const [provider, setProvider] = useState<ReceiptsProvider>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api.me().then(
      (me) => setProvider(me.receiptsProvider ?? 'anthropic'),
      (e: Error) => setError(e.message),
    );
  }, []);
  if (error)
    return (
      <>
        <BackButton onClick={() => navigate('/', { replace: true })} />
        <ErrorView message={error} />
      </>
    );
  if (!provider) return <Loading />;
  return <LegalPage doc={policy(lang, provider)} />;
}

/** Shared by the privacy policy and the terms: a structured text with a back button. */
export function LegalPage({ doc: p }: { doc: Policy }) {
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
