import { useEffect, useRef, useState } from 'react';
import type { SettledKind } from '../../shared/settled.ts';
import { takeCelebration } from './celebration.ts';
import { t } from './i18n.ts';
import { haptic } from './tg.tsx';

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
export function Celebration({ groupId }: { groupId: number }) {
  const [kind, setKind] = useState<SettledKind | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const k = takeCelebration(groupId);
    if (k) setKind(k);
  }, [groupId]);

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
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: закрывается и кнопкой внутри
    <div className="celebration" role="dialog" aria-modal="true" onClick={() => setKind(null)}>
      <canvas ref={canvas} className="celebration-canvas" />
      <div className="celebration-card">
        {/* Временно эмодзи; позже заменим на маскота (#20). */}
        <div className="celebration-emoji">🪙</div>
        <h2>{t(kind === 'group' ? 'celebrate.groupTitle' : 'celebrate.meTitle')}</h2>
        <p>{t(kind === 'group' ? 'celebrate.groupText' : 'celebrate.meText')}</p>
        <button type="button" className="small-btn">
          {t('celebrate.close')}
        </button>
      </div>
    </div>
  );
}
