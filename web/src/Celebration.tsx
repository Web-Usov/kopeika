import { useEffect, useRef, useState } from 'react';
import { achievementTextKey, achievementTitleKey } from '../../shared/achievements.ts';
import type { GroupDetail } from './api.ts';
import { type Pending, takeCelebration } from './celebration.ts';
import { canFinish, finishTrip } from './finish.ts';
import { t } from './i18n.ts';
import { haptic } from './tg.tsx';
import { ACHIEVEMENT_ICON, CelebrationModal, Emblem } from './ui.tsx';

const COLORS = ['#b87333', '#d4a017', '#e8b04a', '#c9622d', '#f2d27a'];
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Лёгкое конфетти на canvas: ~120 частиц, останавливается, когда все упали. */
function confetti(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  const parts = Array.from({ length: 120 }, () => ({
    x: w / 2,
    y: h * 0.4,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 12 - 3,
    size: 5 + Math.random() * 5,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.4,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }));
  let raf = 0;
  const frame = () => {
    ctx.clearRect(0, 0, w, h);
    let alive = 0;
    for (const p of parts) {
      p.vy += 0.3;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      if (p.y > h + 20) continue;
      alive++;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (alive > 0) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

/** Оверлей «всё в расчёте»: показывается один раз после сохранения, закрывается тапом или через ~4 с. */
export function Celebration({ g }: { g: GroupDetail }) {
  const [kind, setKind] = useState<Pending | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const k = takeCelebration(g.id);
    if (k) setKind(k);
  }, [g.id]);

  useEffect(() => {
    if (!kind) return;
    haptic.success();
    const stop = canvas.current && !reducedMotion() ? confetti(canvas.current) : () => {};
    const timer = setTimeout(() => setKind(null), 4000);
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [kind]);

  if (!kind) return null;
  // Закрытие всех долгов важнее; иначе — новое достижение.
  const [first] = kind.achievements;
  const view = kind.kind
    ? {
        emblem: <Emblem icon="check" tone="pos" size={88} />,
        title: t(kind.kind === 'group' ? 'celebrate.groupTitle' : 'celebrate.meTitle'),
        text: t(kind.kind === 'group' ? 'celebrate.groupText' : 'celebrate.meText'),
      }
    : {
        emblem: <Emblem icon={ACHIEVEMENT_ICON[first]} tone="brand" size={88} />,
        title: kind.achievements.map((id) => t(achievementTitleKey(id))).join(', '),
        text: t(kind.achievements.length === 1 ? achievementTextKey(first) : 'achievements.newTitle'),
      };
  const close = () => setKind(null);
  return (
    <CelebrationModal
      backdrop={<canvas ref={canvas} className="celebration-canvas" />}
      emblem={view.emblem}
      title={view.title}
      text={view.text}
      actionLabel={t('celebrate.close')}
      onAction={close}
      ghostLabel={canFinish(g) ? t('celebrate.finishTrip') : undefined}
      onGhost={() => void finishTrip(g)}
      onDismiss={close}
    />
  );
}
