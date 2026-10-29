import { type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode, useId } from 'react';
import type { AchievementId } from '../../shared/achievements.ts';
import { type CategoryId, type CategoryTone, categoryIcon, categoryTone } from '../../shared/categories.ts';
import type { Key } from '../../shared/i18n/index.ts';
import { formatMoney } from '../../shared/money.ts';
import type { Member } from './api.ts';
import { dateLocale, lang, t } from './i18n.ts';
import { Icon, type IconName } from './icons.tsx';

// Компоненты дизайн-кода v1 (design/v1/README.md, раздел 4). Живой каталог — экран #/kit (?dev=1).
// Цвета, размеры и отступы — только токены из tokens.css; новых литералов здесь быть не должно.

export { MainButton } from './tg.tsx';

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** Состояние, которое каталог может показать классом (в приложении не используется). */
type ForceState = 'pressed' | 'focus';

/* ---------- Каркас ---------- */

/** Колонка экрана: боковые отступы `--sp-4`, между секциями `--sp-6`; `dense` — `--sp-4` (экран группы). */
export function Screen({
  dense = false,
  className,
  children,
}: {
  dense?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return <main className={cx('page', 'screen', dense && 'dense', className)}>{children}</main>;
}

/** Заголовок экрана (`.ttl`) и необязательный подзаголовок `lead`. */
export function ScreenTitle({
  children,
  lead,
  center = false,
}: {
  children: ReactNode;
  lead?: ReactNode;
  /** По центру — шапка главной. */
  center?: boolean;
}) {
  return (
    <>
      <h1 className={cx('ttl', center && 'center')}>{children}</h1>
      {lead && <p className={cx('lead', center && 'center')}>{lead}</p>}
    </>
  );
}

export type InsetPx = 16 | 52 | 60 | 64 | 68;

/**
 * Секция. `aside` — ссылка или сумма справа в заголовке; `inset` — отступ разделителей строк
 * (16 по умолчанию; 52, 60, 64 или 68, когда слева аватар или плитка).
 */
export function Section({
  title,
  aside,
  children,
  footer,
  inset,
  bare = false,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  inset?: InsetPx;
  /** Без поверхности: содержимое (чипы) лежит прямо на фоне экрана. */
  bare?: boolean;
}) {
  return (
    <section className="section">
      {(title || aside) && (
        <div className={cx('section-title', aside ? 'section-title-row' : false)}>
          {aside ? <span>{title}</span> : title}
          {aside && <span className="aside">{aside}</span>}
        </div>
      )}
      <div
        className={cx('section-body', bare && 'bare')}
        style={inset ? ({ '--inset': `${inset}px` } as CSSProperties) : undefined}
      >
        {children}
      </div>
      {footer && <div className="section-footer">{footer}</div>}
    </section>
  );
}

/** Поверхность с отступом `--sp-4` — для содержимого, которое не список. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('card', className)}>{children}</div>;
}

/**
 * Шаги (`.steps`) — `Card` с номерами в кружках и линией между ними; над карточкой заголовок секции.
 * Первый запуск: «Как это работает».
 */
export function Steps({ title, items }: { title?: ReactNode; items: { title: ReactNode; text: ReactNode }[] }) {
  return (
    <section className="section">
      {title && <div className="section-title">{title}</div>}
      <Card className="steps">
        {items.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: шаги статичны, порядок не меняется
          <div className="step" key={i}>
            <span className="step-n" aria-hidden="true">
              {i + 1}
            </span>
            <span className="step-body">
              <b>{item.title}</b>
              <span className="hint">{item.text}</span>
            </span>
          </div>
        ))}
      </Card>
    </section>
  );
}

/**
 * Содержимое `Section` для ссылки-приглашения: ссылка моноширинным, «Скопировать» (`tint`) и «Отправить» (`primary`)
 * поровну; ниже, через разделитель, необязательная строка `rotate` («Новая ссылка-приглашение»).
 */
export function InviteCard({
  link,
  copyLabel,
  shareLabel,
  onCopy,
  onShare,
  rotateLabel,
  onRotate,
}: {
  link: string;
  copyLabel: string;
  shareLabel: string;
  onCopy: () => void;
  onShare: () => void;
  rotateLabel?: string;
  onRotate?: () => void;
}) {
  return (
    <>
      <div className="invite">
        <div className="invite-link">{link}</div>
        <div className="btn-pair">
          <Button variant="tint" wide icon="copy" onClick={onCopy}>
            {copyLabel}
          </Button>
          <Button variant="primary" wide icon="share" onClick={onShare}>
            {shareLabel}
          </Button>
        </div>
      </div>
      {rotateLabel && onRotate && (
        <Row tone="link" left={<Icon name="repeat" size={22} stroke={1.9} />} title={rotateLabel} onClick={onRotate} />
      )}
    </>
  );
}

/** Подвал главной: ссылки в одну строку (`.links`) и версия (`.ver`). */
export function LegalLinks({ links, version }: { links: { label: string; onClick: () => void }[]; version: string }) {
  return (
    <footer className="legal">
      <div className="links">
        {links.map((l) => (
          <button type="button" key={l.label} onClick={l.onClick}>
            {l.label}
          </button>
        ))}
      </div>
      <p className="ver">{version}</p>
    </footer>
  );
}

/* ---------- Плитки, аватары, плашки ---------- */

export type TileTone =
  | 'food'
  | 'groc'
  | 'home'
  | 'taxi'
  | 'fun'
  | 'shop'
  | 'other'
  | 'link'
  | 'brand'
  | 'pos'
  | 'neg'
  | 'gray'
  | 'solid-blue'
  | 'solid-orange'
  | 'solid-green'
  | 'solid-purple'
  | 'solid-gray'
  | 'solid-red'
  | 'a1'
  | 'a2'
  | 'a3'
  | 'a4'
  | 'a5'
  | 'a6'
  | 'a7';

/**
 * Плитка 40 (или `size="s"` — 32). `tone`: категория — цветная иконка на фоне 15 %; `link`, `brand`, `pos`, `neg`, `gray`;
 * `solid-*` — белая иконка на цвете (настройки). Буква группы — `text` с тоном `a1`…`a7` (цвет аватара).
 */
export function Tile({
  icon,
  text,
  tone = 'link',
  size,
}: {
  icon?: IconName;
  text?: string;
  tone?: TileTone;
  size?: 's';
}) {
  return (
    <span className={cx('tile', `tone-${tone}`, size === 's' && 's')} aria-hidden="true">
      {icon ? <Icon name={icon} size={size === 's' ? 18 : 22} stroke={size === 's' ? 2.2 : 1.9} /> : text}
    </span>
  );
}

/** Плитка категории: иконка и тон берутся из `shared/categories.ts`. */
export function CategoryTile({ category, size }: { category: CategoryId | string; size?: 's' }) {
  return <Tile icon={categoryIcon(category)} tone={categoryTone(category)} size={size} />;
}

export type AvatarSize = 'l' | 'm' | 's' | 'xs';
const AVATAR_PX: Record<AvatarSize, number> = { l: 44, m: 36, s: 28, xs: 22 };
type AvatarMember = Pick<Member, 'id' | 'name' | 'photoUrl'>;

/**
 * Аватар участника. `size` — `l | m | s | xs` (44 / 36 / 28 / 22) или число пикселей (как раньше).
 * `badge` — значок действия малой плиткой 18 px в правом нижнем углу (история).
 */
export function Avatar({
  member,
  size = 'm',
  badge,
}: {
  member: AvatarMember;
  size?: AvatarSize | number;
  badge?: { icon: IconName; tone?: TileTone };
}) {
  const initials = member.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  const named =
    typeof size === 'number' ? (Object.keys(AVATAR_PX) as AvatarSize[]).find((k) => AVATAR_PX[k] === size) : size;
  const style = named ? undefined : { width: size, height: size, fontSize: Number(size) * 0.4 };
  const avatar = (
    <span className={cx('avatar', `a${(member.id % 7) + 1}`, named)} style={style}>
      {member.photoUrl ? <img src={member.photoUrl} alt="" /> : initials}
    </span>
  );
  if (!badge) return avatar;
  return (
    <span className="av-wrap">
      {avatar}
      <span className="av-badge" aria-hidden="true">
        <span className={`tone-${badge.tone ?? 'link'}`}>
          <Icon name={badge.icon} size={12} stroke={2.4} />
        </span>
      </span>
    </span>
  );
}

/** Круг-заглушка размера `m` с плюсом: «добавить участника». Лежит в строке на месте аватара; `tint` — акцентная (строка-ссылка «Добавить…»). */
export function AvatarAdd({ tint = false }: { tint?: boolean }) {
  return (
    <span className={cx('avatar', 'm', 'add', tint && 'tint')} aria-hidden="true">
      <Icon name="plus" size={20} stroke={2} />
    </span>
  );
}

/** Несколько аватаров с наложением 8 px и обводкой цветом секции. */
export function AvatarStack({ members, size = 'm' }: { members: AvatarMember[]; size?: AvatarSize }) {
  return (
    <span className="stack">
      {members.map((m) => (
        <Avatar key={m.id} member={m} size={size} />
      ))}
    </span>
  );
}

export function Badge({ tone = 'link', children }: { tone?: 'link' | 'brand' | 'gray'; children: ReactNode }) {
  return <span className={cx('badge', tone !== 'link' && tone)}>{children}</span>;
}

/** Круг 72 (или 88) с иконкой: пустые состояния, приглашение, итоги, праздник. Вместо иконки можно передать children. */
export function Emblem({
  icon,
  tone = 'link',
  size = 72,
  label,
  children,
}: {
  icon?: IconName;
  tone?: 'link' | 'brand' | 'pos' | 'neg' | 'gray';
  size?: 72 | 88;
  /** Эмблема с самостоятельным смыслом получает role="img" и подпись; без неё она декоративна. */
  label?: string;
  children?: ReactNode;
}) {
  return (
    <span
      className={cx('emb', `tone-${tone}`, size === 88 && 'lg')}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {icon ? <Icon name={icon} size={size / 2} /> : children}
    </span>
  );
}

export function Money({ value, currency, signed = false }: { value: number; currency: string; signed?: boolean }) {
  const cls = !signed || value === 0 ? '' : value > 0 ? 'pos' : 'neg';
  const sign = signed && value > 0 ? '+' : signed && value < 0 ? '−' : '';
  return <span className={`money ${cls}`}>{sign + formatMoney(Math.abs(value), currency, lang)}</span>;
}

/* ---------- Строки ---------- */

/** Правая колонка строки: сумма и подпись 13 px. */
export function RowValue({ amount, caption }: { amount: ReactNode; caption?: ReactNode }) {
  return (
    <span className="rr">
      <span>{amount}</span>
      {caption && <small>{caption}</small>}
    </span>
  );
}

/**
 * Строка списка. `tone`: `link` (синий текст, «Добавить…»), `danger` (красный). Длинный заголовок обрезается,
 * с `wrap` — переносится. `chevron` — стрелка «дальше». `action` — отдельная кнопка справа
 * (кнопку нельзя вкладывать в кнопку, поэтому строка делится на две части).
 */
export function Row(props: {
  left?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  action?: ReactNode;
  className?: string;
  tone?: 'link' | 'danger';
  wrap?: boolean;
  chevron?: boolean;
  /** Прозрачный нативный контрол (select, input date) поверх строки: строка выбора, см. `PickRow`. */
  native?: ReactNode;
  forceState?: ForceState;
}) {
  const content = (
    <>
      {props.left && <span className="row-left">{props.left}</span>}
      <span className="row-main">
        <span className="row-title">{props.title}</span>
        {props.subtitle && <span className="row-subtitle">{props.subtitle}</span>}
      </span>
      {props.right !== undefined && <span className="row-right">{props.right}</span>}
      {props.chevron && (
        <span className="chev" aria-hidden="true">
          <Icon name="chev" size={18} stroke={2.2} />
        </span>
      )}
    </>
  );
  const cls = cx(
    props.tone === 'link' && 'link',
    props.tone === 'danger' && 'danger',
    props.wrap && 'wrap',
    props.forceState && `is-${props.forceState}`,
    props.className,
  );
  if (props.native) {
    return (
      // biome-ignore lint/a11y/noLabelWithoutControl: нативный контрол приходит в props.native
      <label className={cx('row', 'clickable', 'pick', cls)}>
        {content}
        {props.native}
      </label>
    );
  }
  if (props.onClick && props.action) {
    return (
      <div className={cx('row', 'clickable', 'split', cls)}>
        <button type="button" className="row-hit" onClick={props.onClick}>
          {content}
        </button>
        {props.action}
      </div>
    );
  }
  if (props.onClick) {
    return (
      <button type="button" className={cx('row', 'clickable', cls)} onClick={props.onClick}>
        {content}
      </button>
    );
  }
  return <div className={cx('row', cls)}>{content}</div>;
}

/**
 * Строка выбора («Кто платил», «Когда», «Повторять»): плитка-иконка, значение справа и шеврон.
 * Сам выбор — нативный контрол в `native` (класс `pick-native`): он лежит прозрачным поверх строки.
 */
export function PickRow({
  icon,
  title,
  subtitle,
  value,
  muted = false,
  native,
}: {
  icon: IconName;
  title: ReactNode;
  subtitle?: ReactNode;
  value: ReactNode;
  /** Значение по умолчанию («Не повторять») — подсказочным цветом. */
  muted?: boolean;
  native: ReactNode;
}) {
  return (
    <Row
      left={<Tile icon={icon} tone="gray" size="s" />}
      title={title}
      subtitle={subtitle}
      right={<span className={cx('pick-value', muted && 'muted')}>{value}</span>}
      chevron
      native={native}
    />
  );
}

/* ---------- Кнопки и выбор ---------- */

export function Spinner() {
  return <span className="spin" aria-hidden="true" />;
}

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
  /** `primary` — цвет темы; `tint` — подсказка; `fill` — вторичное; `ghost` — текстовое. */
  variant?: 'primary' | 'tint' | 'fill' | 'ghost';
  size?: 's';
  wide?: boolean;
  icon?: IconName;
  loading?: boolean;
  forceState?: ForceState;
};

export function Button({
  variant = 'primary',
  size,
  wide,
  icon,
  loading = false,
  disabled,
  forceState,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cx(
        'btn',
        variant === 'primary' ? 'pri' : variant,
        size === 's' && 'sm',
        wide && 'wide',
        forceState && `is-${forceState}`,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <Spinner /> : icon && <Icon name={icon} size={size === 's' ? 18 : 20} stroke={2.2} />}
      {children}
    </button>
  );
}

/** Кнопка-иконка 44×44. `label` обязателен: это aria-label. */
export function IconButton({
  icon,
  label,
  variant = 'plain',
  onClick,
  disabled,
  forceState,
}: {
  icon: IconName;
  label: string;
  variant?: 'plain' | 'fill' | 'mute';
  onClick?: () => void;
  disabled?: boolean;
  forceState?: ForceState;
}) {
  return (
    <button
      type="button"
      className={cx('ibtn', variant !== 'plain' && variant, forceState && `is-${forceState}`)}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} size={20} stroke={2} />
    </button>
  );
}

export function Segmented<T extends string>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented">
      {props.options.map((o) => (
        <button
          type="button"
          key={o.value}
          className={o.value === props.value ? 'active' : ''}
          aria-pressed={o.value === props.value}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface ToggleProps {
  on: boolean;
  /** Без `onChange` элемент декоративный (строка вокруг него сама кнопка). */
  onChange?: (on: boolean) => void;
  /** Подпись для скринридера; нужна, когда задан `onChange`. */
  label?: string;
  disabled?: boolean;
}

function toggle(base: string, role: 'switch' | 'checkbox' | 'radio', p: ToggleProps, inner?: ReactNode) {
  const cls = cx(base, p.on && 'on');
  const onChange = p.onChange;
  if (!onChange) {
    return (
      <span className={cls} aria-hidden="true">
        {inner}
      </span>
    );
  }
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: роль приходит параметром (switch, checkbox или radio) — все они поддерживают aria-checked
    <button
      type="button"
      className={cls}
      role={role}
      aria-checked={p.on}
      aria-label={p.label}
      disabled={p.disabled}
      onClick={() => onChange(role === 'radio' ? true : !p.on)}
    >
      {inner}
    </button>
  );
}

export const Switch = (p: ToggleProps) => toggle('switch', 'switch', p);
export const Check = (p: ToggleProps) =>
  toggle('check', 'checkbox', p, p.on ? <Icon name="check" size={16} stroke={2.6} /> : null);
export const Radio = (p: ToggleProps) => toggle('radio', 'radio', p);

export function Stepper({
  value,
  min = 0,
  max = 99,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <span className="stepper">
      <button
        type="button"
        aria-label={t('common.decrease')}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Icon name="minus" size={18} stroke={2.2} />
      </button>
      <span>{value}</span>
      <button
        type="button"
        aria-label={t('common.increase')}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Icon name="plus" size={18} stroke={2.2} />
      </button>
    </span>
  );
}

/** Выбор категории, участника, действие (`dashed`). Чипы переносятся по строкам: кладите их в `<Chips>`. */
export function Chip({
  selected = false,
  icon,
  tone,
  avatar,
  dashed = false,
  onClick,
  disabled,
  forceState,
  children,
}: {
  selected?: boolean;
  icon?: IconName;
  /** Цвет иконки (категория), по умолчанию — цвет текста чипа. */
  tone?: TileTone;
  avatar?: AvatarMember;
  dashed?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  forceState?: ForceState;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cx('chip', selected && 'on', dashed && 'dash', avatar && 'p', forceState && `is-${forceState}`)}
      aria-pressed={selected}
      onClick={onClick}
      disabled={disabled}
    >
      {avatar && <Avatar member={avatar} size="xs" />}
      {icon && (
        <span className={cx('chip-ic', tone && `tone-${tone}`)}>
          <Icon name={icon} size={18} stroke={2.2} />
        </span>
      )}
      {children}
    </button>
  );
}

export function Chips({ children }: { children: ReactNode }) {
  return <div className="chips wrap">{children}</div>;
}

/* ---------- Поля ---------- */

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>;

/** Подпись слева 104 px, поле справа (реквизиты). */
export function FieldRow({
  label,
  error,
  suffix,
  ...input
}: InputProps & {
  label: string;
  error?: string /** Единица справа от поля («₽/GEL»): значение выравнивается вправо. */;
  suffix?: ReactNode;
}) {
  return (
    <>
      <label className={cx('row', 'field-row', suffix ? 'has-suffix' : false)}>
        <span className="field-label">{label}</span>
        <input {...input} className={error ? 'input-err' : undefined} aria-invalid={error ? true : undefined} />
        {suffix && <span className="field-suffix">{suffix}</span>}
      </label>
      {error && <div className="err">{error}</div>}
    </>
  );
}

/** Подпись 13 px над крупным полем 17 px (название группы, заведение). */
export function BigField({ label, error, ...input }: InputProps & { label: string; error?: string }) {
  return (
    <label className="blk">
      <span className="blk-label">{label}</span>
      <input {...input} aria-invalid={error ? true : undefined} />
      {error && <span className="err">{error}</span>}
    </label>
  );
}

/** Поле суммы в строке позиции: 40 px, фон `--fill`. */
export function Box({
  invalid = false,
  narrow = false,
  ...input
}: InputProps & { invalid?: boolean /** 96 px вместо 120: слева нужно место под название. */; narrow?: boolean }) {
  return (
    <span className={cx('box', narrow && 'narrow', invalid && 'input-err')}>
      <input {...input} aria-invalid={invalid || undefined} />
    </span>
  );
}

/** Поле быстрой траты: 48 px, иконка `bolt`; в фокусе — рамка `--btn` и ореол `--tint`. */
export function QuickInput({ forceFocus = false, ...input }: InputProps & { forceFocus?: boolean }) {
  return (
    <label className={cx('quick', forceFocus && 'on')}>
      <Icon name="bolt" size={20} stroke={2.2} />
      <input {...input} />
    </label>
  );
}

/** Знак валюты для плашки: «₽», «$», «₾»; если знака нет — код. */
export function currencySign(code: string): string {
  try {
    const parts = new Intl.NumberFormat(dateLocale, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
}

/** Валюта в выборе: знак и название из словаря, «₽ Рубль». Общая для формы группы и чека. */
export function currencyLabel(code: string): string {
  return `${currencySign(code)} ${t(`currencies.${code}` as Key)}`;
}

/**
 * Карточка суммы (форма траты и перевода): подпись, число 44 px по центру, валюта плашкой (нативный выбор),
 * название под чертой, ниже — строки-`children` (курс, «Разобрать чек» — `AmountAction`, чип «Весь долг»).
 * `error` — текст под числом. Без `currency` плашки нет (перевод в валюте группы).
 */
export function AmountCard({
  label,
  value,
  onChange,
  placeholder = '0',
  error,
  currency,
  title,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  /** Без `options` и `onChange` плашка статичная — валюта не выбирается (перевод). */
  currency?: { value: string; options?: string[]; onChange?: (c: string) => void; label: string };
  /** Название под чертой (поле по центру). */
  title?: InputProps;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="amt">
      <div className="amt-main">
        <label className="amt-label" htmlFor={id}>
          {label}
        </label>
        <div className="amt-line">
          <input
            id={id}
            className={cx('amt-input', error && 'input-err')}
            inputMode="decimal"
            size={Math.max(1, value.length)}
            placeholder={placeholder}
            value={value}
            aria-invalid={error ? true : undefined}
            onChange={(e) => onChange(e.target.value)}
          />
          {currency &&
            (currency.onChange ? (
              <label className="amt-cur">
                <span aria-hidden="true">{currencySign(currency.value)}</span>
                <Icon name="down" size={16} stroke={2.2} />
                <select
                  className="pick-native"
                  aria-label={currency.label}
                  value={currency.value}
                  onChange={(e) => currency.onChange?.(e.target.value)}
                >
                  {(currency.options ?? [currency.value]).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="amt-cur">{currencySign(currency.value)}</span>
            ))}
        </div>
        {error && <div className="amt-error">{error}</div>}
      </div>
      {title && (
        <div className="amt-title">
          <input {...title} className="amt-name" />
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * «Кто → кому» (форма перевода): `Card` с двумя аватарами `l`, стрелкой и именами с выбором (нативный `select`).
 * `from` и `to` — подпись над именем, выбранный участник, обработчик и `display` (вместо имени: «Вы» / «Вам»); `members[].label` — имя в списке.
 */
export function TransferPair({
  members,
  from,
  to,
  error,
}: {
  members: (AvatarMember & { label: string })[];
  from: { value: number; label: string; display?: string; onChange: (id: number) => void };
  to: { value: number; label: string; display?: string; onChange: (id: number) => void };
  error?: string;
}) {
  const side = ({ value, label, display, onChange }: typeof from) => {
    const member = members.find((m) => m.id === value) ?? members[0];
    return (
      <label className="xfer-who">
        <Avatar member={member} size="l" />
        <span className="xfer-caption">{label}</span>
        <span className="xfer-name">
          <span>{display ?? member.label}</span>
          <Icon name="down" size={16} stroke={2.2} />
        </span>
        <select
          className="pick-native"
          aria-label={label}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
    );
  };
  return (
    <Card>
      <div className="xfer-pair">
        {side(from)}
        <span className="xfer-arrow" aria-hidden="true">
          <Icon name="chev" size={20} stroke={2.2} />
        </span>
        {side(to)}
      </div>
      {error && <div className="err xfer-err">{error}</div>}
    </Card>
  );
}

/** Чип-подсказка внутри `AmountCard` («Весь долг · 1 200 ₽»): подставляет сумму. */
export function AmountChip({
  selected,
  onClick,
  children,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="amt-chips">
      <Chip selected={selected} onClick={onClick}>
        {children}
      </Chip>
    </div>
  );
}

/** Строка действия внутри `AmountCard` («Разобрать чек · осталось 3 из 5»): ссылка по центру и подпись. */
export function AmountAction({
  icon,
  caption,
  onClick,
  disabled,
  children,
}: {
  icon: IconName;
  caption?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button type="button" className="amt-act" onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={20} stroke={2} />
      <span>{children}</span>
      {caption && <small>· {caption}</small>}
    </button>
  );
}

/* ---------- Общие паттерны ---------- */

/** Пустое состояние и экран ошибки: эмблема, заголовок, подсказка, необязательное действие (children). */
export function EmptyState({
  icon,
  tone = 'link',
  title,
  hint,
  children,
}: {
  icon: IconName;
  tone?: 'link' | 'brand' | 'pos' | 'neg' | 'gray';
  title: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Emblem icon={icon} tone={tone} />
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {children}
    </div>
  );
}

/** Шапка приглашения и привязки чата: эмблема, название `title-l`, подпись и необязательный ряд (`AvatarStack`). */
export function Intro({
  emblem,
  title,
  lead,
  children,
}: {
  emblem: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="intro">
      {emblem}
      <h1 className="intro-title">{title}</h1>
      {lead && <p className="intro-lead">{lead}</p>}
      {children}
    </header>
  );
}

/**
 * Сводная полоса категорий (итоги) и легенда под ней. Ширина сегмента — доля `value`; цвет — по `tone` категории
 * (`categoryTone`). Смысл не держится на цвете: каждый сегмент подписан в легенде.
 */
export function StackBar({ items }: { items: { tone: CategoryTone; value: number; label: ReactNode }[] }) {
  return (
    <div className="stackbar">
      <div className="stackbar-track" aria-hidden="true">
        {items.map((i) => (
          <span key={i.tone} className={`seg-${i.tone}`} style={{ flexGrow: i.value }} />
        ))}
      </div>
      <ul className="stackbar-legend">
        {items.map((i) => (
          <li key={i.tone}>
            <span className={`dot seg-${i.tone}`} aria-hidden="true" />
            {i.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Плитка факта (итоги): малая плитка, подпись, значение `headline` и пояснение (сумма).
 * `compact` — строка на всю ширину: плитка слева, справа подпись и строка `value` (сумма и название).
 */
export function Fact({
  icon,
  tone,
  label,
  value,
  caption,
  compact = false,
}: {
  icon: IconName;
  tone: TileTone;
  label: ReactNode;
  value: ReactNode;
  caption?: ReactNode;
  compact?: boolean;
}) {
  if (compact)
    return (
      <div className="fact compact">
        <Tile icon={icon} tone={tone} />
        <div className="fact-text">
          <div className="fact-label">{label}</div>
          <div className="fact-line">{value}</div>
        </div>
      </div>
    );
  return (
    <div className="fact">
      <Tile icon={icon} tone={tone} size="s" />
      <div className="fact-label">{label}</div>
      <div className="fact-value">{value}</div>
      {caption && <div className="fact-caption">{caption}</div>}
    </div>
  );
}

/**
 * Достижение: получено — кружок с медной обводкой и подпись «получено»; не получено — серый кружок
 * (для счётных — число `count`), а с `progress` ещё и медная полоса и «5 из 10».
 * `hint` — описание условия (всплывающая подсказка).
 */
export function Medal({
  icon,
  title,
  hint,
  unlocked,
  progress,
  count,
}: {
  icon: IconName;
  title: ReactNode;
  hint?: string;
  unlocked: boolean;
  progress?: { current: number; target: number };
  /** Число вместо иконки в сером кружке («10», «100»). */
  count?: number;
}) {
  const ratio = progress ? Math.min(1, progress.current / Math.max(1, progress.target)) : 0;
  return (
    <div className={cx('medal', unlocked ? 'on' : 'off')} title={hint}>
      <span className="medal-icon" aria-hidden="true">
        {!unlocked && count !== undefined ? count : <Icon name={icon} size={22} />}
      </span>
      <span className="medal-title">{title}</span>
      {unlocked && <span className="medal-state">{t('achievements.got')}</span>}
      {!unlocked && progress && (
        <>
          <span className="medal-bar" aria-hidden="true">
            <span style={{ width: `${ratio * 100}%` }} />
          </span>
          <span className="medal-progress">
            {t('achievements.progress', { current: progress.current, target: progress.target })}
          </span>
        </>
      )}
    </div>
  );
}

/** Зелёная галочка с текстом, например «сходится». */
export function OkLine({ children }: { children: ReactNode }) {
  return (
    <div className="ok">
      <Icon name="check" size={18} stroke={2.4} />
      <span>{children}</span>
    </div>
  );
}

export function Loading() {
  return (
    <div className="center hint" role="status">
      <EmptyState icon="clock" tone="gray" title={t('common.loading')} />
    </div>
  );
}

export function ErrorView({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="center">
      <EmptyState icon="info" tone="neg" title={message} hint={hint} />
    </div>
  );
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDay(iso: string): string {
  const today = todayIso();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  if (iso === today) return t('common.today');
  if (iso === yesterday) return t('common.yesterday');
  const [yy, mm, dd] = iso.split('-').map(Number);
  const date = new Date(yy, mm - 1, dd);
  return new Intl.DateTimeFormat(dateLocale, {
    day: 'numeric',
    month: 'long',
    ...(yy !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  }).format(date);
}

/* ---------- Траты ---------- */

/** День в списке трат или истории: заголовок секции с суммой трат за день справа (переводы в сумму не входят; в истории суммы нет). */
export function DayHeader({
  day,
  total,
  inset = 68,
  children,
}: {
  day: string;
  total?: ReactNode;
  /** Отступ разделителей: 68 под плиткой 40, 64 под аватаром `m` (история). */
  inset?: InsetPx;
  children: ReactNode;
}) {
  return (
    <Section title={day} aside={total} inset={inset}>
      {children}
    </Section>
  );
}

/**
 * Строка траты: плитка категории, название, «Платил(а) X», справа сумма и подписи («доля X» или «вы не участвуете»).
 * Перевод — `transfer`: плитка со стрелками, без категории.
 */
export function ExpenseRow({
  category,
  transfer = false,
  title,
  subtitle,
  amount,
  captions,
  onClick,
}: {
  category?: CategoryId | string;
  transfer?: boolean;
  title: ReactNode;
  subtitle: ReactNode;
  amount: ReactNode;
  /** Подписи под суммой, по строке на элемент. */
  captions?: ReactNode[];
  onClick?: () => void;
}) {
  return (
    <Row
      onClick={onClick}
      left={transfer ? <Tile icon="transfer" tone="gray" /> : <CategoryTile category={category ?? 'other'} />}
      title={title}
      subtitle={subtitle}
      right={
        <RowValue
          amount={amount}
          caption={captions?.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: подписи статичны, порядок не меняется
            <span className="rr-line" key={i}>
              {c}
            </span>
          ))}
        />
      }
    />
  );
}

/** Предпросмотр быстрой траты: плитка категории, «Категория · сумма», хвост и две кнопки поровну (children). */
export function QuickPreview({
  category,
  title,
  amount,
  tail,
  children,
}: {
  category: CategoryId | string;
  title: ReactNode;
  amount: ReactNode;
  tail: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="qp">
      <div className="qp-head">
        <CategoryTile category={category} />
        <div className="qp-text">
          <div className="qp-title">
            <b>{title}</b> · {amount}
          </div>
          <div className="qp-tail">{tail}</div>
        </div>
      </div>
      <div className="qp-actions">{children}</div>
    </Card>
  );
}

/* ---------- Шапка группы ---------- */

/** Шапка группы: `Card` с названием, подписью, кнопкой настроек и содержимым (`BalanceBlock`, `GroupActions`). Одинакова на всех вкладках. */
export function GroupHeader({
  title,
  subtitle,
  settingsLabel,
  onSettings,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  settingsLabel: string;
  onSettings: () => void;
  children?: ReactNode;
}) {
  return (
    <Card className="hdr">
      <div className="hdr-top">
        <div className="hdr-text">
          <h1>{title}</h1>
          <div className="hdr-sub">{subtitle}</div>
        </div>
        <IconButton icon="settings" label={settingsLabel} variant="fill" onClick={onSettings} />
      </div>
      {children}
    </Card>
  );
}

/**
 * Блок баланса: подпись, сумма 26 px, фон по знаку (`pos` — вам должны, `neg` — вы должны, `zero` — в расчёте или пусто).
 * `action` — малая кнопка справа. Вместо суммы можно передать `text` («Вы в расчёте») — тогда слева галочка в плитке.
 */
export function BalanceBlock({
  tone,
  label,
  amount,
  text,
  action,
}: {
  tone: 'pos' | 'neg' | 'zero';
  label: string;
  amount?: ReactNode;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className={cx('bal', tone)}>
      {text && <Tile icon="check" tone="pos" />}
      <div className="bal-main">
        <div className="bal-l">{label}</div>
        <div className={cx('bal-v', text && 'sm')}>{text ?? amount}</div>
      </div>
      {action}
    </div>
  );
}

export type GroupAction = { icon: IconName; label: string; onClick: () => void; badge?: string };

/** Ряд действий плитками 60 px: иконка над подписью, у действия может быть счётчик медью. */
export function GroupActions({ items }: { items: GroupAction[] }) {
  return (
    <div className={cx('acts', items.length === 2 ? 'n2' : 'n3')}>
      {items.map((a) => (
        <button key={a.icon} type="button" className="act" onClick={a.onClick}>
          <Icon name={a.icon} size={22} stroke={1.9} />
          {a.label}
          {a.badge && <span className="bdg">{a.badge}</span>}
        </button>
      ))}
    </div>
  );
}

/** Плашка «пример»: медный фон, плитка-иконка, текст и малая красная кнопка. */
export function DemoNote({ text, actionLabel, onAction }: { text: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="note">
      <Tile icon="info" tone="brand" size="s" />
      <div className="note-text">{text}</div>
      <button type="button" className="btn sm note-btn" onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  );
}

export type DebtLine = { text: string; copyLabel: string; onCopy: () => void; copied?: boolean };

/**
 * Карточка долга: аватар, имя, подпись («должен(на) вам» / «вы должны») и сумма; реквизиты строками
 * с кнопкой «Скопировать» (`lines`) или подсказка, если их нет (`hint`); ряд кнопок (`children`) и причина,
 * если действие недоступно (`reason`).
 */
export function DebtCard({
  member,
  caption,
  amount,
  lines,
  hint,
  reason,
  children,
}: {
  member: AvatarMember;
  caption: string;
  amount: ReactNode;
  lines?: DebtLine[];
  hint?: string;
  reason?: string;
  children?: ReactNode;
}) {
  return (
    <Card className="debt">
      <div className="debt-head">
        <Avatar member={member} size="l" />
        <div className="debt-who">
          <div className="debt-name">{member.name}</div>
          <div className="debt-cap">{caption}</div>
        </div>
        <div className="debt-sum">{amount}</div>
      </div>
      {lines && lines.length > 0 && (
        <div className="debt-lines">
          {lines.map((l) => (
            <div key={l.text} className="debt-line">
              <span className="debt-text">{l.text}</span>
              <IconButton icon={l.copied ? 'check' : 'copy'} label={l.copyLabel} onClick={l.onCopy} />
            </div>
          ))}
        </div>
      )}
      {hint && <div className="debt-hint">{hint}</div>}
      {children && <div className="btn-pair">{children}</div>}
      {reason && <div className="debt-reason">{reason}</div>}
    </Card>
  );
}

/** Полоса баланса с чертой посередине: вправо зелёная (вам должны), влево красная (вы должны). `ratio` — доля от 0 до 1. */
export function BalanceTrack({ value, ratio }: { value: number; ratio: number }) {
  const width = `${Math.min(1, Math.max(0, ratio)) * 50}%`;
  return (
    <span className="track" aria-hidden="true">
      {value !== 0 && <i className={value > 0 ? 'r' : 'l'} style={{ width }} />}
    </span>
  );
}

/** Строка баланса в одну линию: аватар `s`, имя, полоса от центральной черты и сумма справа. */
export function BalanceRow({
  member,
  name,
  value,
  ratio,
  amount,
}: {
  member: AvatarMember;
  name: ReactNode;
  value: number;
  ratio: number;
  amount: ReactNode;
}) {
  return (
    <div className="row brow">
      <Avatar member={member} size="s" />
      <span className="brow-name">{name}</span>
      <BalanceTrack value={value} ratio={ratio} />
      <span className={cx('brow-amount', value > 0 && 'pos', value < 0 && 'neg')}>{amount}</span>
    </div>
  );
}

/** Строка статистики: малая плитка категории, название и сумма на одной линии, под ними полоса цвета категории (`ratio` от 0 до 1). */
export function CategoryStat({
  category,
  title,
  amount,
  ratio,
}: {
  category: CategoryId | string;
  title: ReactNode;
  amount: ReactNode;
  ratio: number;
}) {
  return (
    <div className="row cstat">
      <CategoryTile category={category} size="s" />
      <div className="cstat-main">
        <div className="cstat-line">
          <span className="cstat-title">{title}</span>
          <span className="cstat-amount">{amount}</span>
        </div>
        <span className="stat-bar">
          <i
            className={`stat-fill tone-${categoryTone(category)}`}
            style={{ width: `${Math.min(1, Math.max(0, ratio)) * 100}%` }}
          />
        </span>
      </div>
    </div>
  );
}

/**
 * Плитка фото (`.photo`): иконка в плитке `--tint`, подпись; под ней скрытый выбор файла.
 * `capture` — сразу камера. Две плитки кладут в `<PhotoTiles>`.
 */
export function PhotoTile({
  icon,
  label,
  capture = false,
  onFile,
}: {
  icon: IconName;
  label: string;
  capture?: boolean;
  onFile: (file: File | undefined) => void;
}) {
  return (
    <label className="photo">
      <span className="pi" aria-hidden="true">
        <Icon name={icon} size={26} stroke={2} />
      </span>
      {label}
      <input
        type="file"
        accept="image/*"
        {...(capture ? { capture: 'environment' as const } : {})}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // тот же файл можно выбрать снова
          onFile(file);
        }}
      />
    </label>
  );
}

/** Две плитки фото в ряд, поровну. */
export function PhotoTiles({ children }: { children: ReactNode }) {
  return <div className="photos">{children}</div>;
}

/** Советы с зелёными галочками (`.tips`): старт разбора чека. */
export function Tips({ items }: { items: ReactNode[] }) {
  return (
    <ul className="tips">
      {items.map((item, i) => (
        <li className="tip" key={i}>
          <span aria-hidden="true">
            <Icon name="check" size={20} stroke={2.4} />
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

/** Иконки достижений: `Medal` в «Итогах» и эмблема в `CelebrationModal`. */
export const ACHIEVEMENT_ICON: Record<AchievementId, IconName> = {
  first: 'sprout',
  crew: 'users',
  ten: 'receipt',
  hundred: 'flame',
  travelers: 'globe',
  allCategories: 'palette',
  clean: 'check',
  week: 'calendar',
  month: 'clock',
};

/**
 * Модалка праздника (`.modal` на `.scrim`): эмблема 88, заголовок `title-m`, текст, `Button primary wide`
 * и необязательная `Button ghost wide`. Конфетти (`backdrop`) рисуется между затемнением и карточкой.
 */
export function CelebrationModal({
  emblem,
  title,
  text,
  actionLabel,
  onAction,
  ghostLabel,
  onGhost,
  backdrop,
  onDismiss,
}: {
  emblem: ReactNode;
  title: ReactNode;
  text: ReactNode;
  actionLabel: string;
  onAction: () => void;
  ghostLabel?: string;
  onGhost?: () => void;
  backdrop?: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: закрывается и кнопкой внутри
    <div className="scrim" role="dialog" aria-modal="true" onClick={onDismiss}>
      {backdrop}
      <div className="modal">
        {emblem}
        <h2 className="modal-title">{title}</h2>
        <p className="modal-text">{text}</p>
        <div className="modal-actions">
          <Button wide onClick={onAction}>
            {actionLabel}
          </Button>
          {ghostLabel && onGhost && (
            <Button variant="ghost" wide onClick={onGhost}>
              {ghostLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Плашка «Завершить поездку» (`.finish-banner`): `Card` с обводкой `--brand`, плитка-галочка, заголовок,
 * текст и две кнопки поровну — `primary` и `fill`.
 */
export function FinishBanner({ onFinish, onLater }: { onFinish: () => void; onLater: () => void }) {
  return (
    <Card className="finish-banner">
      <div className="finish-head">
        <Tile icon="check" tone="pos" />
        <div className="finish-body">
          <div className="finish-title">{t('group.allSettledTitle')}</div>
          <div className="hint">{t('group.allSettledText')}</div>
        </div>
      </div>
      <div className="finish-actions">
        <Button onClick={onFinish}>{t('group.finish')}</Button>
        <Button variant="fill" onClick={onLater}>
          {t('group.finishLater')}
        </Button>
      </div>
    </Card>
  );
}
