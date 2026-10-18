import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode } from 'react';
import { type CategoryId, categoryIcon, categoryTone } from '../../shared/categories.ts';
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
export function ScreenTitle({ children, lead }: { children: ReactNode; lead?: ReactNode }) {
  return (
    <>
      <h1 className="ttl">{children}</h1>
      {lead && <p className="lead">{lead}</p>}
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
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  inset?: InsetPx;
}) {
  return (
    <section className="section">
      {(title || aside) && (
        <div className={cx('section-title', aside ? 'section-title-row' : false)}>
          {aside ? <span>{title}</span> : title}
          {aside && <span className="aside">{aside}</span>}
        </div>
      )}
      <div className="section-body" style={inset ? ({ '--inset': `${inset}px` } as CSSProperties) : undefined}>
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
  avatar,
  dashed = false,
  onClick,
  disabled,
  forceState,
  children,
}: {
  selected?: boolean;
  icon?: IconName;
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
      {icon && <Icon name={icon} size={18} stroke={2.2} />}
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
export function FieldRow({ label, error, ...input }: InputProps & { label: string; error?: string }) {
  return (
    <>
      <label className="row field-row">
        <span className="field-label">{label}</span>
        <input {...input} className={error ? 'input-err' : undefined} aria-invalid={error ? true : undefined} />
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
export function Box({ invalid = false, ...input }: InputProps & { invalid?: boolean }) {
  return (
    <span className={cx('box', invalid && 'input-err')}>
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

export function ErrorView({ message }: { message: string }) {
  return (
    <div className="center">
      <EmptyState icon="info" tone="neg" title={message} />
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
