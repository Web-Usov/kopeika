import { useEffect, useState } from 'react';
import { ACHIEVEMENT_EMOJI, achievementTextKey, achievementTitleKey } from '../../../shared/achievements.ts';
import { categoryEmoji, categoryKey } from '../../../shared/categories.ts';
import { formatMoney } from '../../../shared/money.ts';
import { type GroupSummary, periodText, shortDay, summaryShareText } from '../../../shared/summary.ts';
import { api, useGroup } from '../api.ts';
import { lang, t } from '../i18n.ts';
import { navigate } from '../router.ts';
import {
  alertDialog,
  BackButton,
  canShareMessage,
  copyText,
  haptic,
  MainButton,
  shareLink,
  shareMessage,
} from '../tg.tsx';
import { Avatar, ErrorView, Loading, Row, Section } from '../ui.tsx';

export function Summary({ id }: { id: number }) {
  const { data: g, error } = useGroup(id);
  // The group payload only carries the newest expenses, so the summary is computed by the server over all of them.
  const [s, setS] = useState<GroupSummary>();
  const [summaryError, setSummaryError] = useState<string>();
  const stamp = g ? `${g.expensesTotal}:${g.totalSpent}` : '';
  useEffect(() => {
    if (!stamp) return;
    api.summary(id).then(setS, (e: Error) => setSummaryError(e.message));
  }, [id, stamp]);
  const back = <BackButton onClick={() => navigate(`/g/${id}`, { replace: true })} />;
  if (!g || !s)
    return (
      <div className="page">
        {back}
        {error || summaryError ? <ErrorView message={(error ?? summaryError)!} /> : <Loading />}
      </div>
    );

  const money = (n: number) => formatMoney(n, g.currency, lang);
  const name = (memberId: number) => g.members.find((m) => m.id === memberId)?.name ?? t('common.unknownMember');

  if (s.count === 0) {
    return (
      <div className="page">
        {back}
        <div className="empty">
          <div className="empty-emoji">🏆</div>
          <p>{t('summary.empty')}</p>
          <p className="hint">{t('summary.emptyHint')}</p>
        </div>
      </div>
    );
  }

  const achievements = g.achievements;

  const share = async () => {
    if (canShareMessage() && !g.isDemo) {
      try {
        const { id } = await api.prepareShare(g.id, 'summary');
        await shareMessage(id);
      } catch (e) {
        await alertDialog((e as Error).message);
      }
      return;
    }
    const text = summaryShareText(g.name, g.currency, s, lang);
    if (g.inviteLink) {
      shareLink(g.inviteLink, text);
    } else if (await copyText(text)) {
      await alertDialog(t('summary.copied'));
    }
  };

  const maxPaid = Math.max(1, ...s.members.map((m) => Math.max(m.paid, m.consumed)));

  return (
    <div className="page">
      {back}
      <header className="group-header">
        <div className="hero-emoji">🏆</div>
        <h2>{g.name}</h2>
        <div className="hint">{periodText(s, lang)}</div>
      </header>

      <div className="summary-card summary-hero">
        <div className="summary-label">{t('summary.total')}</div>
        <div className="summary-big">{money(s.total)}</div>
        <div className="summary-label">{t('summary.expensesCount', { count: s.count })}</div>
      </div>

      <div className="summary-grid">
        {s.topCategory && (
          <div className="summary-card">
            <div className="summary-emoji">{categoryEmoji(s.topCategory.category)}</div>
            <div className="summary-label">{t('summary.topCategory')}</div>
            <div className="summary-value">{t(categoryKey(s.topCategory.category))}</div>
            <div className="summary-label">{money(s.topCategory.amount)}</div>
          </div>
        )}
        {s.topDay && (
          <div className="summary-card">
            <div className="summary-emoji">🔥</div>
            <div className="summary-label">{t('summary.topDay')}</div>
            <div className="summary-value">{shortDay(s.topDay.day, lang)}</div>
            <div className="summary-label">{money(s.topDay.amount)}</div>
          </div>
        )}
      </div>

      {s.biggest && (
        <div className="summary-card">
          <div className="summary-emoji">💎</div>
          <div className="summary-label">{t('summary.biggest')}</div>
          <div className="summary-value">{money(s.biggest.amount)}</div>
          <div className="summary-label">{t('summary.biggestBy', { name: name(s.biggest.payerId) })}</div>
        </div>
      )}

      <Section title={t('summary.members')}>
        {s.members.map((m) => (
          <Row
            key={m.id}
            left={<Avatar member={g.members.find((x) => x.id === m.id)!} />}
            title={m.name}
            subtitle={
              <>
                {m.title && (
                  <span className="title-chip">
                    {m.title.emoji} {m.title.label}
                  </span>
                )}
                <span className="bar">
                  <span className="accent" style={{ width: `${(m.paid / maxPaid) * 100}%` }} />
                </span>
              </>
            }
            right={
              <span className="stack-right">
                <span>{t('summary.paid', { amount: money(m.paid) })}</span>
                <span className="hint small">{t('summary.consumed', { amount: money(m.consumed) })}</span>
              </span>
            }
          />
        ))}
      </Section>

      <Section title={t('achievements.title')}>
        {achievements.map((a) => (
          <div key={a.id} className={`achievement ${a.unlocked ? 'unlocked' : 'locked'}`}>
            <div className="achievement-emoji">{ACHIEVEMENT_EMOJI[a.id]}</div>
            <div className="achievement-body">
              <div className="achievement-title">{t(achievementTitleKey(a.id))}</div>
              <div className="hint small">{t(achievementTextKey(a.id))}</div>
            </div>
            {a.progress && (
              <div className="achievement-progress hint small">
                {t('achievements.progress', { current: a.progress.current, target: a.progress.target })}
              </div>
            )}
          </div>
        ))}
      </Section>

      <MainButton
        text={t('summary.share')}
        onClick={() => {
          haptic.tap();
          share();
        }}
      />
    </div>
  );
}
