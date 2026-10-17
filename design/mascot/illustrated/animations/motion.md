# Движения Копейки

Параметры взяты из `design/mascot/tools/animate.py` (словарь `MOTION`). Точка вращения и сжатия у всех образов — между ступнями: `transform-origin: 50% 96%` (низ фигуры по центру). Сжатие всегда с сохранением площади: `scaleX = 1 / scaleY`. Все петли бесшовные.

| Образ | Длит. | Движение | Амплитуды | Easing |
|---|---|---|---|---|
| greeting | 2.0 с | два подскока за петлю + наклон влево-вправо | наклон ±5.5°, подскок 16 px (из 512), сжатие при приземлении 6% | синус для наклона, парабола для подскока, косинусное сглаживание сжатия |
| settled | 2.5 с | дыхание + мерцание искорок | scaleY 1 ± 2.5%; искорки: масштаб ±22%, прозрачность 0.45–1, два мерцания за петлю, фаза сдвинута на искорку | синус |
| thinking | 2.5 с | покачивание + парение | наклон ±3.5°, парение ±6 px, фазы сдвинуты на 90° | синус |
| worried | 2.0 с | дрожь 0.3 с, пауза, дрожь с 1.0 с, пауза | ±2.5 px по X, поворот ±0.8°, 10 Гц | огибающая sin^1.5 |
| error | 2.0 с | затухающее покачивание 1.5 с, затем пауза | начальный размах 10°, затухание exp(−3t), 1.8 Гц | экспонента, хвост гасится плавно |
| celebrate | 2.5 с | прыжок с лёгким растяжением в полёте, приземление со сжатием, возврат | прыжок 62 px, наклон ±4° в полёте, scaleY 0.90–1.05 (сжатие только при приземлении); конфетти 20 штук, веер из-за монеты при отрыве, медленное падение и угасание | косинусное сглаживание между ключами; конфетти: вылет + сопротивление + падение |

Размеры в px даны для холста 512×512; в интерфейсе масштабируйте пропорционально (ниже в `%` от размера картинки).
Видеостикеры — 30 fps, GIF-превью — 20 fps (all.gif — 8 fps, 10 с, плитки 128 px).

Для интерфейса: анимируем WebP (`web/public/brand/mascot/<имя>.webp`) через CSS, без видео. Конфетти и искорки в CSS не воспроизводятся (искорки запечены в картинку). Всё обёрнуто в `prefers-reduced-motion`: при «уменьшить движение» картинка остаётся статичной.

## greeting

```css
@media (prefers-reduced-motion: no-preference) {
  .mascot-greeting {
    transform-origin: 50% 96%;
    animation: kopeika-greeting 2s infinite;
  }
  @keyframes kopeika-greeting {
    0%    { transform: translateY(0) rotate(-5.5deg) scale(1, 1); animation-timing-function: ease-out; }
    12%   { transform: translateY(-3.1%) rotate(-3deg) scale(0.98, 1.05); animation-timing-function: ease-in; }
    25%   { transform: translateY(0) rotate(0deg) scale(1.03, 0.94); animation-timing-function: ease-out; }
    35%   { transform: translateY(0) rotate(2.5deg) scale(1, 1); }
    50%   { transform: translateY(0) rotate(5.5deg) scale(1, 1); animation-timing-function: ease-out; }
    62%   { transform: translateY(-3.1%) rotate(3deg) scale(0.98, 1.05); animation-timing-function: ease-in; }
    75%   { transform: translateY(0) rotate(0deg) scale(1.03, 0.94); animation-timing-function: ease-out; }
    85%   { transform: translateY(0) rotate(-2.5deg) scale(1, 1); }
    100%  { transform: translateY(0) rotate(-5.5deg) scale(1, 1); }
  }
}
@media (prefers-reduced-motion: reduce) {
  .mascot-greeting { animation: none; }
}
```

## thinking

```css
@media (prefers-reduced-motion: no-preference) {
  .mascot-thinking {
    transform-origin: 50% 96%;
    animation: kopeika-thinking 2.5s ease-in-out infinite;
  }
  @keyframes kopeika-thinking {
    0%   { transform: translateY(-1.2%) rotate(0deg); }
    25%  { transform: translateY(0) rotate(3.5deg); }
    50%  { transform: translateY(1.2%) rotate(0deg); }
    75%  { transform: translateY(0) rotate(-3.5deg); }
    100% { transform: translateY(-1.2%) rotate(0deg); }
  }
}
@media (prefers-reduced-motion: reduce) {
  .mascot-thinking { animation: none; }
}
```

## celebrate

Разовое: запускать один раз (`animation-iteration-count: 1`) или повторять по событию. Конфетти — отдельные частицы, в CSS их нет.

```css
@media (prefers-reduced-motion: no-preference) {
  .mascot-celebrate {
    transform-origin: 50% 96%;
    animation: kopeika-celebrate 2.5s both;
  }
  @keyframes kopeika-celebrate {
    0%, 14% { transform: translateY(0) rotate(0deg) scale(1, 1);        animation-timing-function: ease-out; }
    20%  { transform: translateY(-2%) rotate(1deg) scale(0.95, 1.05);    animation-timing-function: ease-out; }   /* взлёт, лёгкое растяжение */
    32%  { transform: translateY(-12.1%) rotate(0deg) scale(0.98, 1.02); animation-timing-function: ease-in; }    /* верх */
    47%  { transform: translateY(-4%) rotate(-3deg) scale(0.95, 1.05);   animation-timing-function: ease-in; }    /* падение */
    50%  { transform: translateY(0) rotate(0deg) scale(0.96, 1.04);      animation-timing-function: ease-out; }   /* касание */
    53.5%{ transform: translateY(0) rotate(0deg) scale(1.11, 0.90);      animation-timing-function: ease-out; }   /* сжатие, 3-4 кадра */
    58%  { transform: translateY(0) rotate(0deg) scale(0.97, 1.03);      animation-timing-function: ease-in-out; }
    65%  { transform: translateY(0) rotate(0deg) scale(1.01, 0.99);      animation-timing-function: ease-in-out; }
    72%, 100% { transform: translateY(0) rotate(0deg) scale(1, 1); }
  }
}
@media (prefers-reduced-motion: reduce) {
  .mascot-celebrate { animation: none; }
}
```

Ключи celebrate (32% = верх прыжка, 12.1% высоты ≈ 62 px из 512) — приближение к покадровому рендеру: у рендера полёт идёт по параболе между 14% и 50%, в CSS она аппроксимирована тремя ключами.
