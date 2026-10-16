import type { ReactNode } from 'react';
import { formatMoney } from '../../shared/money.ts';
import type { Member } from './api.ts';

const palette = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774'];

export function Avatar({ member, size = 36 }: { member: Pick<Member, 'id' | 'name' | 'photoUrl'>; size?: number }) {
  const initials = member.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span className="avatar" style={{ width: size, height: size, background: palette[member.id % palette.length], fontSize: size * 0.4 }}>
      {member.photoUrl ? <img src={member.photoUrl} alt="" /> : initials}
    </span>
  );
}

export function Money({ value, currency, signed = false }: { value: number; currency: string; signed?: boolean }) {
  const cls = !signed || value === 0 ? '' : value > 0 ? 'pos' : 'neg';
  const sign = signed && value > 0 ? '+' : signed && value < 0 ? '−' : '';
  return <span className={`money ${cls}`}>{sign + formatMoney(Math.abs(value), currency)}</span>;
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
  className?: string;
}) {
  const Tag = props.onClick ? 'button' : 'div';
  return (
    <Tag className={`row ${props.onClick ? 'clickable' : ''} ${props.className ?? ''}`} onClick={props.onClick}>
      {props.left && <span className="row-left">{props.left}</span>}
      <span className="row-main">
        <span className="row-title">{props.title}</span>
        {props.subtitle && <span className="row-subtitle">{props.subtitle}</span>}
      </span>
      {props.right !== undefined && <span className="row-right">{props.right}</span>}
    </Tag>
  );
}

export function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {props.options.map((o) => (
        <button key={o.value} className={o.value === props.value ? 'active' : ''} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Loading() {
  return <div className="center hint">Загрузка…</div>;
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
  if (iso === today) return 'Сегодня';
  if (iso === yesterday) return 'Вчера';
  const [yy, mm, dd] = iso.split('-').map(Number);
  const date = new Date(yy, mm - 1, dd);
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(yy !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  }).format(date);
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
