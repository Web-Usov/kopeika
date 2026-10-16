import type { ReactNode } from 'react';
import { formatMoney } from '../../shared/money.ts';
import type { Member } from './api.ts';
import { dateLocale, lang, t } from './i18n.ts';

const palette = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774'];

export function Avatar({ member, size = 36 }: { member: Pick<Member, 'id' | 'name' | 'photoUrl'>; size?: number }) {
  const initials = member.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background: palette[member.id % palette.length], fontSize: size * 0.4 }}
    >
      {member.photoUrl ? <img src={member.photoUrl} alt="" /> : initials}
    </span>
  );
}

export function Money({ value, currency, signed = false }: { value: number; currency: string; signed?: boolean }) {
  const cls = !signed || value === 0 ? '' : value > 0 ? 'pos' : 'neg';
  const sign = signed && value > 0 ? '+' : signed && value < 0 ? '−' : '';
  return <span className={`money ${cls}`}>{sign + formatMoney(Math.abs(value), currency, lang)}</span>;
}

export function Section({ title, children, footer }: { title?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="section">
      {title && <div className="section-title">{title}</div>}
      <div className="section-body">{children}</div>
      {footer && <div className="section-footer">{footer}</div>}
    </section>
  );
}

export function Row(props: {
  left?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  /** Отдельная кнопка справа: кнопку нельзя вкладывать в кнопку, поэтому строка делится на две части. */
  action?: ReactNode;
  className?: string;
}) {
  const content = (
    <>
      {props.left && <span className="row-left">{props.left}</span>}
      <span className="row-main">
        <span className="row-title">{props.title}</span>
        {props.subtitle && <span className="row-subtitle">{props.subtitle}</span>}
      </span>
      {props.right !== undefined && <span className="row-right">{props.right}</span>}
    </>
  );
  if (props.onClick && props.action) {
    return (
      <div className={`row clickable split ${props.className ?? ''}`}>
        <button type="button" className="row-hit" onClick={props.onClick}>
          {content}
        </button>
        {props.action}
      </div>
    );
  }
  if (props.onClick) {
    return (
      <button type="button" className={`row clickable ${props.className ?? ''}`} onClick={props.onClick}>
        {content}
      </button>
    );
  }
  return <div className={`row ${props.className ?? ''}`}>{content}</div>;
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
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Loading() {
  return <div className="center hint">{t('common.loading')}</div>;
}

export function ErrorView({ message }: { message: string }) {
  return (
    <div className="center">
      <div className="empty-emoji">😕</div>
      <div>{message}</div>
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
