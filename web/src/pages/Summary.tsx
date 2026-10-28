import { useEffect, useState } from 'react';
import { type AchievementId, achievementTextKey, achievementTitleKey } from '../../../shared/achievements.ts';
import { type CategoryTotal, categoryIcon, categoryKey, categoryTone } from '../../../shared/categories.ts';
import { formatMoney } from '../../../shared/money.ts';
import { type GroupSummary, summaryShareText } from '../../../shared/summary.ts';
import { api, useGroup } from '../api.ts';
import { dateLocale, lang, t } from '../i18n.ts';
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
import {
  ACHIEVEMENT_ICON,
  Avatar,
  Badge,
  Card,
  Emblem,
  EmptyState,
  ErrorView,
  Fact,
  Loading,
  Medal,
  Row,
  RowValue,
  Screen,
  ScreenTitle,
  Section,
  StackBar,
} from '../ui.tsx';

const dateOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const COUNTED: AchievementId[] = ['ten', 'hundred', 'week', 'month'];

const cx = (...parts: (string | false)[]) => parts.filter(Boolean).join(' ');

export function Summary({ id }: { id: number }) {
  const { data: g, error } = useGroup(id);
  // The group payload only carries the newest expenses, so the summary is computed by the server over all of them.
  const [s, setS] = useState<GroupSummary>();
  const [summaryError, setSummaryError] = useState<string>();
  const [categories, setCategories] = useState<CategoryTotal[]>([]);
  const stamp = g ? `${g.expensesTotal}:${g.totalSpent}` : '';
  useEffect(() => {
    if (!stamp) return;
    api.summary(id).then(setS, (e: Error) => setSummaryError(e.message));
    api.stats(id).then(
      (r) => setCategories(r.group),
      () => {},
    );
  }, [id, stamp]);
  const back = <BackButton onClick={() => navigate(`/g/${id}`, { replace: true })} />;
  if (!g || !s)
    return (
      <Screen>
        {back}
        {error || summaryError ? <ErrorView message={(error ?? summaryError)!} /> : <Loading />}
      </Screen>
    );

  const money = (n: number) => formatMoney(n, g.currency, lang);
  const name = (memberId: number) => g.members.find((m) => m.id === memberId)?.name ?? t('common.unknownMember');

  if (s.count === 0) {
    return (
      <Screen>
        {back}
        <EmptyState icon="trophy" tone="brand" title={t('summary.empty')} hint={t('summary.emptyHint')} />
      </Screen>
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
  const unlocked = achievements.filter((a) => a.unlocked).length;
  const biggest = s.biggest && g.expenses.find((e) => e.id === s.biggest?.id);
  const totalText = money(s.total);
  const dayFmt = new Intl.DateTimeFormat(dateLocale, { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const day = (iso: string) => dayFmt.format(dateOf(iso));
  const period =
    !s.firstDay || !s.lastDay
      ? ''
      : s.firstDay === s.lastDay
        ? day(s.firstDay)
        : dayFmt.formatRange(dateOf(s.firstDay), dateOf(s.lastDay));
  const medals = [...achievements].sort((a, b) => Number(b.unlocked) - Number(a.unlocked));

  return (
    <Screen>
      {back}
      <header className="sum-head">
        <Emblem icon="trophy" tone="brand" />
        <ScreenTitle center lead={`${period} · ${t('common.members', { count: g.members.length })}`}>
          {g.name}
        </ScreenTitle>
      </header>

      <Card className="sum-total">
        <div className="sum-total-label">
          {t('summary.total')} · {t('summary.expensesCount', { count: s.count })}
        </div>
        <div className={cx('sum-total-amount', totalText.length > 11 && 'long')}>{totalText}</div>
        {categories.length > 0 && (
          <StackBar
            items={categories.map((c) => ({
              tone: categoryTone(c.category),
              value: c.amount,
              label: t(categoryKey(c.category)),
            }))}
          />
        )}
      </Card>

      {(s.topCategory || s.topDay || s.biggest) && (
        <div className="facts">
          {s.topCategory && (
            <Fact
              icon={categoryIcon(s.topCategory.category)}
              tone={categoryTone(s.topCategory.category)}
              label={t('summary.topCategory')}
              value={t(categoryKey(s.topCategory.category))}
              caption={money(s.topCategory.amount)}
            />
          )}
          {s.topDay && (
            <Fact
              icon="flame"
              tone="neg"
              label={t('summary.topDay')}
              value={day(s.topDay.day)}
              caption={money(s.topDay.amount)}
            />
          )}
          {s.biggest && (
            <Fact
              compact
              icon="gem"
              tone="fun"
              label={t('summary.biggest')}
              value={
                <>
                  <b>{money(s.biggest.amount)}</b>
                  {biggest && ` · ${biggest.title}`}
                </>
              }
            />
          )}
        </div>
      )}

      <Section title={t('summary.members')} inset={64} footer={t('summary.titlesNote')}>
        {s.members.map((m) => (
          <Row
            key={m.id}
            left={<Avatar member={g.members.find((x) => x.id === m.id)!} size="m" />}
            title={
              <>
                {m.name}
                {m.title && <Badge tone="brand">{m.title.label}</Badge>}
              </>
            }
            subtitle={
              <span className="paid-bar" aria-hidden="true">
                <span style={{ width: `${(m.paid / maxPaid) * 100}%` }} />
              </span>
            }
            right={
              <RowValue amount={<b>{money(m.paid)}</b>} caption={t('summary.part', { amount: money(m.consumed) })} />
            }
          />
        ))}
      </Section>

      <Section
        title={t('achievements.title')}
        aside={
          <span className="sum-count">
            {t('achievements.counterOf', { done: unlocked, total: achievements.length })}
          </span>
        }
        bare
      >
        <div className="medals">
          {medals.map((a) => (
            <Medal
              key={a.id}
              icon={ACHIEVEMENT_ICON[a.id]}
              title={t(achievementTitleKey(a.id))}
              hint={t(achievementTextKey(a.id))}
              unlocked={a.unlocked}
              progress={a.progress}
              count={COUNTED.includes(a.id) ? a.progress?.target : undefined}
            />
          ))}
        </div>
      </Section>

      <MainButton
        text={t('summary.share')}
        onClick={() => {
          haptic.tap();
          share();
        }}
      />
    </Screen>
  );
}
