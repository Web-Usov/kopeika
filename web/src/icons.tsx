// Иконки дизайн-кода v1 (design/v1/README.md, раздел 3): SVG 24×24, stroke currentColor, скруглённые концы.
// Цвет задаёт родитель. Пути — из конца design/v1/v1.css. Эмодзи остаются только для бота и CSV.

const PATHS = {
  food: 'M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 1.5-3 4-3 7h3',
  cart: 'M3 4h2l2.4 11h10.2L20 7H6.2M9 20h.01M17 20h.01',
  home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5h4v5',
  taxi: 'M5 16v-5l2-5h10l2 5v5M3 16h18M7 19v-3M17 19v-3M7.5 13h.01M16.5 13h.01',
  fun: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z',
  bag: 'M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  transfer: 'M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4',
  userplus: 'M15 20c0-2.8-2.7-5-6-5s-6 2.2-6 5M9 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 8v6M16 11h6',
  chat: 'M4 5h16v11H9l-5 4z',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8M10 17h4',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  card: 'M3 6h18v12H3zM3 10h18M7 15h3',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 21h4',
  chev: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  share: 'M12 3v12M8 7l4-4 4 4M5 13v7h14v-7',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9h.01',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  archive: 'M3 5h18v4H3zM5 9v10h14V9M10 13h4',
  download: 'M12 4v11M8 11l4 4 4-4M5 19h14',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
  logout: 'M15 4h4v16h-4M10 17l-5-5 5-5M5 12h11',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  users:
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-3.9 3.1-7 7-7s7 3.1 7 7M16 3.1a4 4 0 0 1 0 7.8M22 21c0-3.4-2.4-6.2-5.5-6.9',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  flame: 'M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5 1-8.5z',
  gem: 'M6 3h12l3 6-9 12L3 9zM3 9h18M9 3l3 18 3-18',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 11v6M12 7h.01',
  check: 'M5 12l4.5 4.5L19 7',
  globe:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z',
  palette: 'M12 21a9 9 0 1 1 9-9c0 2.5-2 3-3.5 3H16a2 2 0 0 0-1.5 3.3A2 2 0 0 1 12 21zM7.5 11h.01M10 7h.01M15 7.5h.01',
  sprout: 'M12 21v-9M12 12C12 8 9 5 4 5c0 4 3 7 8 7zM12 14c0-3 2.5-6 7-6 0 3.5-2.5 6-7 6z',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z',
  doc: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6',
  split: 'M12 4v16M4 12h4M16 12h4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
} as const;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export function Icon({
  name,
  size = 24,
  stroke = 1.9,
  title,
}: {
  name: IconName;
  size?: number;
  /** В малых иконках (18–20 px) дизайн-код ставит 2–2,4. */
  stroke?: number;
  /** Иконка с самостоятельным смыслом: получает role="img" и подпись. Без неё — aria-hidden. */
  title?: string;
}) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: декоративна (aria-hidden) либо подписана через aria-label
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="icon"
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
