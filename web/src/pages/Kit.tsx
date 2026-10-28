// Каталог компонентов дизайн-кода v1: токены, иконки и каждый компонент во всех вариантах и состояниях.
// Служебный экран: маршрут #/kit регистрируется только при devTools (см. App.tsx), ссылок на него нет.
// Тексты — через словари kit.* (ru/en). Правила и имена — design/v1/README.md.
import { type ReactNode, useEffect, useState } from 'react';
import { CATEGORIES, categoryKey, categoryTone } from '../../../shared/categories.ts';
import { lang, t } from '../i18n.ts';
import { ICON_NAMES, Icon } from '../icons.tsx';
import { navigate } from '../router.ts';
import { applyScheme, BackButton, MainButton } from '../tg.tsx';
import {
  AmountAction,
  AmountCard,
  AmountChip,
  Avatar,
  AvatarAdd,
  AvatarStack,
  Badge,
  BalanceBlock,
  BigField,
  Box,
  Button,
  Card,
  CategoryTile,
  Check,
  Chip,
  Chips,
  DayHeader,
  DemoNote,
  Emblem,
  EmptyState,
  ErrorView,
  ExpenseRow,
  FieldRow,
  GroupActions,
  GroupHeader,
  IconButton,
  InviteCard,
  LegalLinks,
  Loading,
  Money,
  OkLine,
  PickRow,
  QuickInput,
  QuickPreview,
  Radio,
  Row,
  RowValue,
  Screen,
  ScreenTitle,
  Section,
  Segmented,
  Stepper,
  Steps,
  Switch,
  Tile,
  type TileTone,
  TransferPair,
} from '../ui.tsx';

const SURFACE = ['bg', 'sec', 'fill', 'fill2', 'press', 'line', 'line2', 'sep', 'chev', 'seg-on', 'scrim'];
const TEXT = ['text', 'hint', 'sub', 'sub-strong'];
const ACTION = ['link', 'link-strong', 'btn', 'btn-text', 'tint', 'switch'];
const SEMANTIC = ['pos', 'neg', 'pos-tint', 'neg-tint'];
const BRAND = ['brand', 'brand-tint', 'brand-text'];
const CATEGORY = ['c-food', 'c-groc', 'c-home', 'c-taxi', 'c-fun', 'c-shop', 'c-other'];
const AVATAR = ['av-1', 'av-2', 'av-3', 'av-4', 'av-5', 'av-6', 'av-7'];
const SOLID = ['solid-blue', 'solid-orange', 'solid-green', 'solid-purple', 'solid-gray', 'solid-red'];

const TYPE: [token: string, weight: string][] = [
  ['fs-display', '700'],
  ['fs-title-l', '700'],
  ['fs-amount', '700'],
  ['fs-title-m', '700'],
  ['fs-headline', '600'],
  ['fs-body', '400 / 600'],
  ['fs-callout', '400 / 500'],
  ['fs-footnote', '400 / 500'],
  ['fs-caption', '500'],
];
const SPACING = ['sp-1', 'sp-2', 'sp-3', 'sp-4', 'sp-5', 'sp-6', 'sp-8'];
const RADII = ['r-xs', 'r-s', 'r-m', 'r-l', 'r-xl', 'r-pill'];
const SIZES = ['h-row', 'h-btn', 'h-btn-sm', 'h-main', 'h-field', 'h-seg', 'tile', 'tile-s', 'emb', 'emb-l'];

const TONES: TileTone[] = ['food', 'groc', 'home', 'taxi', 'fun', 'shop', 'other', 'link', 'brand', 'pos', 'neg'];
const SOLID_TONES: TileTone[] = [
  'solid-blue',
  'solid-orange',
  'solid-green',
  'solid-purple',
  'solid-gray',
  'solid-red',
];

const tokenValue = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();

function Block({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section className="kit-block" data-kit={id}>
      <h2 className="kit-h">{title}</h2>
      {children}
    </section>
  );
}

function Swatches({ title, tokens }: { title: string; tokens: string[] }) {
  return (
    <div className="kit-group">
      <div className="kit-label">{title}</div>
      <div className="kit-swatches">
        {tokens.map((n) => (
          <div key={n} className="kit-sw" title={tokenValue(n)}>
            <span className="kit-chip" style={{ background: `var(--${n})` }} />
            <code>--{n}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function Variant({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kit-variant">
      <div className="kit-label">{label}</div>
      {children}
    </div>
  );
}

export function Kit() {
  const [scheme, setScheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.dataset.scheme === 'dark' ? 'dark' : 'light',
  );
  const [seg, setSeg] = useState<'a' | 'b' | 'c'>('a');
  const [seg2, setSeg2] = useState<'a' | 'b'>('a');
  const [sw, setSw] = useState(true);
  const [chk, setChk] = useState(true);
  const [radio, setRadio] = useState<'a' | 'b'>('a');
  const [step, setStep] = useState(2);
  const [chip, setChip] = useState<string | null>('food');
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState('3200');
  const [cur, setCur] = useState('RUB');

  useEffect(() => {
    applyScheme(scheme);
  }, [scheme]);
  // Ручной выбор темы живёт только на этом экране: при уходе возвращаем тему клиента.
  useEffect(() => () => applyScheme(), []);

  const switchLang = (next: 'ru' | 'en') => {
    const url = new URL(location.href);
    url.searchParams.set('lang', next);
    location.href = url.toString();
  };

  const members = [
    { id: 1, name: t('kit.memberA'), photoUrl: null },
    { id: 2, name: t('kit.memberB'), photoUrl: null },
    { id: 3, name: t('kit.memberC'), photoUrl: null },
    { id: 4, name: 'D', photoUrl: null },
  ];
  const noop = () => {};

  return (
    <Screen className="kit">
      <BackButton onClick={() => navigate('/')} />
      <ScreenTitle lead={t('kit.lead')}>{t('kit.title')}</ScreenTitle>

      <Section>
        <Row
          title={t('kit.theme')}
          right={
            <Segmented
              value={scheme}
              onChange={setScheme}
              options={[
                { value: 'light', label: t('kit.themeLight') },
                { value: 'dark', label: t('kit.themeDark') },
              ]}
            />
          }
        />
        <Row
          title={t('kit.language')}
          right={
            <Segmented
              value={lang}
              onChange={switchLang}
              options={[
                { value: 'ru', label: 'ru' },
                { value: 'en', label: 'en' },
              ]}
            />
          }
        />
      </Section>

      <Block id="colors" title={t('kit.colors')}>
        <Swatches title={t('kit.groupSurface')} tokens={SURFACE} />
        <Swatches title={t('kit.groupText')} tokens={TEXT} />
        <Swatches title={t('kit.groupAction')} tokens={ACTION} />
        <Swatches title={t('kit.groupSemantic')} tokens={SEMANTIC} />
        <Swatches title={t('kit.groupBrand')} tokens={BRAND} />
        <Swatches title={t('kit.groupCategory')} tokens={CATEGORY} />
        <Swatches title={t('kit.groupAvatar')} tokens={AVATAR} />
        <Swatches title={t('kit.groupSolid')} tokens={SOLID} />
      </Block>

      <Block id="typography" title={t('kit.typography')}>
        <Card>
          {TYPE.map(([token, weight]) => (
            <div key={token} className="kit-type">
              <span style={{ fontSize: `var(--${token})`, fontWeight: Number.parseInt(weight, 10) }}>
                {t('kit.typographySample')}
              </span>
              <code>
                --{token} · {tokenValue(token)} · {weight}
              </code>
            </div>
          ))}
        </Card>
      </Block>

      <Block id="spacing" title={t('kit.spacing')}>
        <Card>
          {SPACING.map((n) => (
            <div key={n} className="kit-scale">
              <span className="kit-bar" style={{ width: `var(--${n})` }} />
              <code>
                --{n} · {tokenValue(n)}
              </code>
            </div>
          ))}
        </Card>
      </Block>

      <Block id="radii" title={t('kit.radii')}>
        <div className="kit-swatches">
          {RADII.map((n) => (
            <div key={n} className="kit-sw">
              <span className="kit-box" style={{ borderRadius: `var(--${n})` }} />
              <code>
                --{n} · {tokenValue(n)}
              </code>
            </div>
          ))}
        </div>
      </Block>

      <Block id="sizes" title={t('kit.sizes')}>
        <Card>
          {SIZES.map((n) => (
            <div key={n} className="kit-scale">
              <span className="kit-bar kit-bar-v" style={{ height: `var(--${n})` }} />
              <code>
                --{n} · {tokenValue(n)}
              </code>
            </div>
          ))}
          <div className="kit-scale">
            <span className="kit-inline">
              <Avatar member={members[0]} size="l" />
              <Avatar member={members[0]} size="m" />
              <Avatar member={members[0]} size="s" />
              <Avatar member={members[0]} size="xs" />
            </span>
            <code>--av-l / m / s / xs · 44 / 36 / 28 / 22</code>
          </div>
        </Card>
      </Block>

      <Block id="icons" title={t('kit.icons')}>
        <div className="kit-icons">
          {ICON_NAMES.map((n) => (
            <div key={n} className="kit-icon" data-icon={n}>
              <Icon name={n} size={24} />
              <code>{n}</code>
            </div>
          ))}
        </div>
      </Block>

      <Block id="shell" title={t('kit.shell')}>
        <Variant label="Screen · ScreenTitle · Section aside footer · Card">
          <Section
            title={t('kit.sampleGroup')}
            aside={
              <Button variant="ghost" size="s">
                {t('kit.sampleAside')}
              </Button>
            }
            footer={t('kit.sampleFooter')}
          >
            <Row title={t('kit.sampleGroup')} subtitle={t('kit.sampleSubtitle')} />
          </Section>
          <Card>{t('kit.sampleFooter')}</Card>
        </Variant>
      </Block>

      <Block id="rows" title={t('kit.rows')}>
        <Section title="Row" inset={68}>
          <Row
            left={<CategoryTile category="food" />}
            title={t('kit.sampleGroup')}
            subtitle={t('kit.sampleSubtitle')}
            right={<RowValue amount={<Money value={95000} currency="RUB" />} caption={t('kit.sampleCaption')} />}
            onClick={noop}
          />
          <Row
            left={<Avatar member={members[1]} />}
            title={t('kit.memberB')}
            subtitle={t('kit.sampleSubtitle')}
            chevron
            onClick={noop}
          />
          <Row
            left={<Tile icon="calendar" tone="gray" />}
            title={t('kit.sampleLong')}
            right={<span className="hint">{t('kit.sampleAside')}</span>}
            chevron
            onClick={noop}
          />
          <Row
            wrap
            left={<Avatar member={members[0]} badge={{ icon: 'plus', tone: 'pos' }} />}
            title={t('kit.sampleLong')}
            subtitle="01:27"
          />
          <Row tone="link" left={<Tile icon="plus" tone="link" size="s" />} title={t('kit.sampleAdd')} onClick={noop} />
          <Row
            tone="danger"
            left={<Tile icon="trash" tone="neg" size="s" />}
            title={t('kit.sampleDelete')}
            onClick={noop}
          />
        </Section>
        <Section title="PickRow · Row danger center" inset={60}>
          <PickRow
            icon="users"
            title={t('expense.whoPaid')}
            value={
              <>
                <Avatar member={members[0]} size="xs" />
                {t('common.you')}
              </>
            }
            native={
              <select className="pick-native" aria-label={t('expense.whoPaid')} defaultValue="a">
                <option value="a">{t('common.you')}</option>
              </select>
            }
          />
          <PickRow
            icon="repeat"
            title={t('recurring.repeat')}
            subtitle={t('kit.sampleSubtitle')}
            value={t('recurring.none')}
            muted
            native={
              <select className="pick-native" aria-label={t('recurring.repeat')} defaultValue="a">
                <option value="a">{t('recurring.none')}</option>
              </select>
            }
          />
          <Row
            tone="danger"
            className="center"
            left={<Icon name="trash" size={20} />}
            title={t('expense.delete')}
            onClick={noop}
          />
        </Section>
        <Section title="Row · switch · tile solid" inset={68}>
          <Row
            left={<Tile icon="bell" tone="solid-orange" />}
            title={t('kit.sampleDefault')}
            right={<Switch on={sw} />}
            onClick={() => setSw(!sw)}
          />
          <Row
            left={<Tile icon="download" tone="solid-green" />}
            title={t('kit.sampleWithIcon')}
            chevron
            onClick={noop}
          />
        </Section>
      </Block>

      <Block id="tiles" title={t('kit.tiles')}>
        <Variant label="Tile">
          <div className="kit-inline kit-wrap">
            {TONES.map((tone) => (
              <Tile key={tone} icon="receipt" tone={tone} />
            ))}
            {SOLID_TONES.map((tone) => (
              <Tile key={tone} icon="settings" tone={tone} />
            ))}
            <Tile text={t('kit.sampleGroup').slice(0, 1)} tone="a3" />
            <Tile icon="receipt" tone="link" size="s" />
          </div>
        </Variant>
        <Variant label="CategoryTile">
          <div className="kit-inline kit-wrap">
            {CATEGORIES.map((c) => (
              <span key={c.id} className="kit-cat">
                <CategoryTile category={c.id} />
                <code>{t(categoryKey(c.id))}</code>
              </span>
            ))}
          </div>
        </Variant>
        <Variant label="Badge">
          <div className="kit-inline">
            <Badge>{t('kit.sampleDefault')}</Badge>
            <Badge tone="brand">{t('kit.sampleExample')}</Badge>
            <Badge tone="gray">3/9</Badge>
          </div>
        </Variant>
        <Variant label="Emblem 72 / 88">
          <div className="kit-inline">
            <Emblem icon="receipt" />
            <Emblem icon="trophy" tone="brand" size={88} />
            <Emblem icon="check" tone="pos" />
            <Emblem icon="info" tone="neg" />
            <Emblem icon="clock" tone="gray" />
          </div>
        </Variant>
        <Variant label="Money">
          <div className="kit-inline">
            <Money value={1527333} currency="RUB" />
            <Money value={95000} currency="RUB" signed />
            <Money value={-95000} currency="RUB" signed />
          </div>
        </Variant>
      </Block>

      <Block id="people" title={t('kit.people')}>
        <Variant label="Avatar l / m / s / xs · badge">
          <div className="kit-inline">
            <Avatar member={members[0]} size="l" />
            <Avatar member={members[1]} size="m" />
            <Avatar member={members[2]} size="s" />
            <Avatar member={members[3]} size="xs" />
            <Avatar member={members[0]} badge={{ icon: 'transfer', tone: 'link' }} />
            <Avatar member={members[1]} badge={{ icon: 'users', tone: 'brand' }} />
          </div>
        </Variant>
        <Variant label="AvatarAdd">
          <Card>
            <AvatarAdd />
          </Card>
        </Variant>
        <Variant label="AvatarStack">
          <Card>
            <AvatarStack members={members} />
          </Card>
        </Variant>
      </Block>

      <Block id="buttons" title={t('kit.buttons')}>
        <Variant label="Button primary · tint · fill · ghost">
          <div className="kit-inline kit-wrap">
            <Button>{t('common.save')}</Button>
            <Button variant="tint">{t('kit.sampleCopy')}</Button>
            <Button variant="fill">{t('kit.sampleCancel')}</Button>
            <Button variant="ghost">{t('kit.sampleManual')}</Button>
          </div>
        </Variant>
        <Variant label='size="s" · icon'>
          <div className="kit-inline kit-wrap">
            <Button size="s" variant="tint">
              {t('kit.sampleRemind')}
            </Button>
            <Button icon="copy" variant="tint">
              {t('kit.sampleCopy')}
            </Button>
            <Button icon="share">{t('kit.sampleSend')}</Button>
          </div>
        </Variant>
        <Variant label="wide · 2 × wide">
          <Button wide>{t('kit.sampleNext')}</Button>
          <div className="kit-pair">
            <Button variant="fill" wide>
              {t('kit.sampleCancel')}
            </Button>
            <Button wide>{t('common.save')}</Button>
          </div>
        </Variant>
        <Variant
          label={`${t('kit.statePressed')} · ${t('kit.stateFocus')} · ${t('kit.stateDisabled')} · ${t('kit.stateLoading')}`}
        >
          <div className="kit-inline kit-wrap">
            <Button forceState="pressed">{t('kit.statePressed')}</Button>
            <Button forceState="focus">{t('kit.stateFocus')}</Button>
            <Button disabled>{t('kit.stateDisabled')}</Button>
            <Button loading>{t('kit.stateLoading')}</Button>
            <Button
              variant="tint"
              loading={loading}
              onClick={() => {
                setLoading(true);
                setTimeout(() => setLoading(false), 1500);
              }}
            >
              {t('common.save')}
            </Button>
          </div>
        </Variant>
        <Variant label="IconButton plain · fill · mute">
          <div className="kit-inline">
            <IconButton icon="pencil" label="pencil" />
            <IconButton icon="settings" label="settings" variant="fill" />
            <IconButton icon="x" label="x" variant="mute" />
            <IconButton icon="copy" label="copy" forceState="pressed" />
            <IconButton icon="trash" label="trash" disabled />
          </div>
        </Variant>
        <Variant label="MainButton (stub outside Telegram)">
          <div className="kit-mbar">
            <MainButton text={t('kit.sampleNext')} onClick={noop} />
          </div>
          <div className="kit-mbar">
            <MainButton
              text={t('kit.sampleNext')}
              onClick={noop}
              above={
                <Button variant="ghost" wide>
                  {t('kit.sampleManual')}
                </Button>
              }
            />
          </div>
          <div className="kit-mbar">
            <MainButton text={t('kit.stateDisabled')} onClick={noop} disabled />
          </div>
          <div className="kit-mbar">
            <MainButton text={t('kit.stateLoading')} onClick={noop} loading />
          </div>
        </Variant>
      </Block>

      <Block id="choice" title={t('kit.choice')}>
        <Variant label="Segmented 3 / 2">
          <Segmented
            value={seg}
            onChange={setSeg}
            options={[
              { value: 'a', label: t('kit.sampleDefault') },
              { value: 'b', label: t('kit.sampleTwo') },
              { value: 'c', label: t('kit.sampleThree') },
            ]}
          />
          <Segmented
            value={seg2}
            onChange={setSeg2}
            options={[
              { value: 'a', label: t('kit.sampleTwo') },
              { value: 'b', label: t('kit.sampleThree') },
            ]}
          />
        </Variant>
        <Variant label="Switch · Check · Radio · Stepper">
          <div className="kit-inline kit-wrap">
            <Switch on={sw} onChange={setSw} label="switch" />
            <Switch on={false} onChange={noop} label="switch off" />
            <Switch on disabled onChange={noop} label="switch disabled" />
            <Check on={chk} onChange={setChk} label="check" />
            <Check on={false} onChange={noop} label="check off" />
            <Radio on={radio === 'a'} onChange={() => setRadio('a')} label="radio a" />
            <Radio on={radio === 'b'} onChange={() => setRadio('b')} label="radio b" />
            <Stepper value={step} min={1} max={5} onChange={setStep} />
          </div>
        </Variant>
        <Variant label="Chip · Chips">
          <Chips>
            {CATEGORIES.slice(0, 4).map((c) => (
              <Chip
                key={c.id}
                icon={c.icon}
                tone={categoryTone(c.id)}
                selected={chip === c.id}
                onClick={() => setChip(chip === c.id ? null : c.id)}
              >
                {t(categoryKey(c.id))}
              </Chip>
            ))}
            <Chip avatar={members[0]} selected>
              {t('kit.memberA')}
            </Chip>
            <Chip avatar={members[1]}>{t('kit.memberB')}</Chip>
            <Chip dashed>{t('kit.sampleSplit')}</Chip>
            <Chip>{t('kit.sampleWholeDebt')}</Chip>
            <Chip forceState="pressed">{t('kit.statePressed')}</Chip>
            <Chip forceState="focus">{t('kit.stateFocus')}</Chip>
            <Chip disabled>{t('kit.stateDisabled')}</Chip>
          </Chips>
        </Variant>
      </Block>

      <Block id="fields" title={t('kit.fields')}>
        <Variant label="FieldRow · BigField">
          <Section>
            <FieldRow label={t('kit.samplePhone')} placeholder={t('kit.samplePhonePlaceholder')} />
            <FieldRow label={t('kit.samplePhone')} defaultValue="+7 900" error={t('kit.sampleFieldError')} />
            <BigField label={t('kit.sampleName')} defaultValue={t('kit.sampleNameValue')} />
            <BigField
              label={t('kit.sampleName')}
              defaultValue=""
              placeholder={t('kit.sampleNameValue')}
              error={t('kit.sampleFieldError')}
            />
          </Section>
        </Variant>
        <Variant label="AmountCard">
          <AmountCard
            label={t('expense.amountLabel')}
            value={amount}
            onChange={setAmount}
            currency={{
              value: cur,
              options: ['RUB', 'USD', 'GEL'],
              onChange: setCur,
              label: t('expense.currencyLabel'),
            }}
            title={{ placeholder: t('expense.titlePlaceholder'), defaultValue: t('kit.sampleNameValue') }}
          >
            <FieldRow label={t('expense.rateLabel')} defaultValue="34,5" suffix="RUB/GEL" />
            <AmountAction icon="camera" caption={t('expense.scanLeft', { left: 3, limit: 5 })} onClick={noop}>
              {t('expense.scan')}
            </AmountAction>
          </AmountCard>
          <AmountCard label={t('expense.amountLabel')} value="1,2,3" onChange={noop} error={t('expense.amountError')} />
          <AmountCard label={t('transfer.amount')} value="1200" onChange={noop}>
            <AmountChip selected>{t('transfer.wholeDebt', { amount: '1 200 ₽' })}</AmountChip>
          </AmountCard>
        </Variant>
        <Variant label="Box">
          <Section>
            <Row title={t('kit.sampleLong')} right={<Box defaultValue="2 400 ₽" inputMode="decimal" />} />
            <Row title={t('kit.stateError')} right={<Box defaultValue="2,4,0" invalid />} />
          </Section>
        </Variant>
        <Variant label={`QuickInput · ${t('kit.stateFocus')}`}>
          <div className="kit-stack">
            <QuickInput placeholder={t('kit.sampleQuick')} />
            <QuickInput forceFocus defaultValue={t('kit.sampleQuickValue')} />
          </div>
        </Variant>
      </Block>

      <Block id="patterns" title={t('kit.patterns')}>
        <Variant label="TransferPair">
          <TransferPair
            members={members.map((m) => ({ ...m, label: m.name }))}
            from={{ value: members[0].id, label: t('transfer.from'), onChange: noop }}
            to={{ value: members[1].id, label: t('transfer.to'), onChange: noop }}
          />
        </Variant>
        <Variant label="Steps">
          <Steps
            title={t('home.welcomeTitle')}
            items={[
              { title: t('home.welcomeStep1Title'), text: t('home.welcomeStep1Text') },
              { title: t('home.welcomeStep2Title'), text: t('home.welcomeStep2Text') },
              { title: t('home.welcomeStep3Title'), text: t('home.welcomeStep3Text') },
            ]}
          />
        </Variant>
        <Variant label="LegalLinks">
          <LegalLinks
            links={[
              { label: t('account.privacy'), onClick: noop },
              { label: t('account.termsShort'), onClick: noop },
            ]}
            version={t('common.version', { version: 'v0.9.0' })}
          />
        </Variant>
        <Variant label="InviteCard">
          <Section>
            <InviteCard
              link="t.me/kopeika_bot?startapp=EhRarscTLEGL"
              copyLabel={t('settings.copy')}
              shareLabel={t('settings.share')}
              onCopy={noop}
              onShare={noop}
              rotateLabel={t('settings.rotateInvite')}
              onRotate={noop}
            />
          </Section>
        </Variant>
        <Variant label="DemoNote">
          <DemoNote text={t('group.demoBanner')} actionLabel={t('group.demoDelete')} onAction={noop} />
        </Variant>
        {(['pos', 'neg', 'zero', 'empty'] as const).map((k) => (
          <Variant key={k} label={`GroupHeader · BalanceBlock ${k}`}>
            <GroupHeader
              title={t('kit.sampleGroupName')}
              subtitle={t('group.headerSub', { members: t('common.members', { count: 4 }), amount: '34 890 ₽' })}
              settingsLabel={t('group.settings')}
              onSettings={noop}
            >
              {k === 'pos' || k === 'neg' ? (
                <BalanceBlock
                  tone={k}
                  label={k === 'pos' ? t('group.owedLabel') : t('group.oweLabel')}
                  amount="15 273,33 ₽"
                  action={
                    <Button variant="fill" size="s" onClick={noop}>
                      {k === 'pos' ? t('group.remind') : t('group.settle')}
                    </Button>
                  }
                />
              ) : (
                <BalanceBlock
                  tone="zero"
                  label={t('group.balance')}
                  {...(k === 'zero' ? { text: t('group.settled') } : { amount: '0 ₽' })}
                />
              )}
              <GroupActions
                items={[
                  { icon: 'userplus', label: t('group.tileInvite'), onClick: noop },
                  { icon: 'chat', label: t('group.tileChat'), onClick: noop },
                  { icon: 'trophy', label: t('group.tileSummary'), onClick: noop, badge: '3/9' },
                ]}
              />
            </GroupHeader>
          </Variant>
        ))}
        <Variant label="DayHeader · ExpenseRow">
          <DayHeader day={t('common.yesterday')} total={<Money value={120000} currency="RUB" />}>
            <ExpenseRow
              category="taxi"
              title={t('kit.sampleQuickValue')}
              subtitle={t('group.paidByMe')}
              amount={<Money value={120000} currency="RUB" />}
              captions={[t('group.notInvolved')]}
              onClick={noop}
            />
            <ExpenseRow
              transfer
              title="→"
              subtitle={t('group.transfer')}
              amount={<Money value={300000} currency="RUB" />}
              onClick={noop}
            />
          </DayHeader>
        </Variant>
        <Variant label="QuickPreview">
          <QuickPreview
            category="taxi"
            title={t(categoryKey('transport'))}
            amount={<Money value={120000} currency="RUB" />}
            tail={t('quick.tail')}
          >
            <Button>{t('quick.add')}</Button>
            <Button variant="fill">{t('quick.edit')}</Button>
          </QuickPreview>
        </Variant>
        <Variant label="OkLine">
          <OkLine>{t('kit.sampleOk')}</OkLine>
        </Variant>
        <Variant label="EmptyState">
          <Card>
            <EmptyState icon="receipt" title={t('kit.sampleEmptyTitle')} hint={t('kit.sampleEmptyHint')}>
              <Button variant="tint">{t('kit.sampleAdd')}</Button>
            </EmptyState>
          </Card>
        </Variant>
        <Variant label="ErrorView">
          <Card>
            <ErrorView message={t('kit.sampleErrorText')} />
          </Card>
        </Variant>
        <Variant label="Loading">
          <Card>
            <Loading />
          </Card>
        </Variant>
      </Block>

      <Block id="states" title={t('kit.states')}>
        <Section>
          <Row title={t('kit.stateNormal')} onClick={noop} />
          <Row title={t('kit.statePressed')} onClick={noop} forceState="pressed" />
          <Row title={t('kit.stateFocus')} onClick={noop} forceState="focus" />
        </Section>
      </Block>
    </Screen>
  );
}
