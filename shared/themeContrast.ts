// Фон экрана Mini App должен быть заметно темнее карточек: так видны границы блоков.
// iOS даёт это сам (#efeff4 под #ffffff, #000000 под #1c1c1e), а Telegram Desktop/Web — не всегда.

export type Scheme = 'light' | 'dark';

/** Цвета темы Telegram (`WebApp.themeParams`), нужные для проверки. */
export interface ThemeColors {
  bg_color?: string;
  secondary_bg_color?: string;
  section_bg_color?: string;
}

/** Минимальная разница яркости (0..1, по гамма-яркости sRGB): iOS light ≈ 0.061, Desktop #f1f1f1/#fff ≈ 0.055. */
export const MIN_LUMA_GAP = 0.058;

/** Во сколько раз темнеет поверхность, чтобы получить фон: светлая ≈ #ebebeb от белого, тёмная — заметно глубже. */
const DARKEN: Record<Scheme, number> = { light: 0.92, dark: 0.6 };

/** `#rgb` / `#rrggbb` → [r, g, b] (0..255); всё остальное — `null`. */
export function parseHex(hex: string | undefined): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex?.trim() ?? '');
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

const luma = ([r, g, b]: [number, number, number]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

const toHex = (rgb: [number, number, number]) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

/**
 * Если фон экрана (`secondary_bg_color`) почти не отличается от поверхности карточек или светлее её —
 * возвращает фон, затемнённый от поверхности; иначе `null` (тема годится как есть, в том числе при неполных данных).
 */
export function correctedScreenBg(theme: ThemeColors | undefined, scheme: Scheme): string | null {
  const screen = parseHex(theme?.secondary_bg_color);
  const surface = parseHex(theme?.section_bg_color) ?? parseHex(theme?.bg_color);
  if (!screen || !surface) return null;
  if (luma(surface) - luma(screen) >= MIN_LUMA_GAP) return null;
  return toHex(surface.map((c) => Math.round(c * DARKEN[scheme])) as [number, number, number]);
}
