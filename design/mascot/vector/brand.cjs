// Бренд-картинки из векторной Копейки (после build.py). Рендер — Playwright (Chromium), как увидит пользователь.
//   node design/mascot/vector/brand.cjs
// Пишет в web/public/brand/:
//   favicon.svg               — упрощённая монета 32×32 для вкладки (читается до 16 px), рисуется здесь же
//   favicon-32.png            — то же в PNG
//   apple-touch-icon-180.png  — монета на кремовом фоне
//   bot-avatar-640.png        — аватар бота: монета «в край», фон цвета контура (Telegram режет в круг)
//   miniapp-640x360.png       — картинка Mini App для @BotFather, охранное поле ¼ ширины монеты
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../..');
const BRAND = path.join(ROOT, 'web/public/brand');
const MASCOT = path.join(BRAND, 'mascot');

const C = {
  outline: '#6B2101',
  dark: '#B15709',
  gold: '#F79A19',
  light: '#FDBC38',
  shine: '#FFFDF4',
  eye: '#22100A',
  tongue: '#EE575A',
  cream: '#F6ECDC',
};
// монета в риге: центр (500, 430), внешний радиус ≈ 280
const COIN_BOX = '220 150 560 560';

// эмоция без мелких эффектов (звёздочки обода, румянец): на маленьких размерах они превращаются в шум
function emotion(id, { clean = false, viewBox } = {}) {
  let svg = fs.readFileSync(path.join(MASCOT, 'emotions', `${id}.svg`), 'utf8');
  // поза эмоции (прыжок, наклон, сжатие) — ровная монета: в квадрат и круг она должна вписываться точно
  svg = svg.replace(/(id="k-(?:jump|tilt|sq)") transform="[^"]*"/g, '$1');
  if (viewBox) svg = svg.replace(/viewBox="[^"]*"/, `viewBox="${viewBox}"`);
  if (clean) svg = svg.replace('<svg ', '<svg data-clean="1" ');
  return svg;
}
const CLEAN_CSS = 'svg[data-clean] [id$="fx_rim"], svg[data-clean] [id$="fx_blush"] { display: none }';

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><title>Копейка</title>
<circle cx="16" cy="16" r="15.2" fill="${C.outline}"/>
<circle cx="16" cy="16" r="13.6" fill="${C.dark}"/>
<circle cx="16" cy="15.4" r="13" fill="${C.gold}"/>
<path d="M7.4 21.6 21.6 7.4A10.4 10.4 0 0 1 24.6 10.4L10.4 24.6A10.4 10.4 0 0 1 7.4 21.6Z" fill="${C.light}"/>
<circle cx="16" cy="15.6" r="10.4" fill="none" stroke="${C.outline}" stroke-width=".9" opacity=".55"/>
<ellipse cx="11.6" cy="14" rx="2.6" ry="2.9" fill="${C.eye}"/>
<ellipse cx="20.4" cy="14" rx="2.6" ry="2.9" fill="${C.eye}"/>
<circle cx="10.8" cy="12.9" r="1" fill="#fff"/>
<circle cx="19.6" cy="12.9" r="1" fill="#fff"/>
<path d="M12.6 18.4h6.8c-.5 2.4-1.8 3.6-3.4 3.6s-2.9-1.2-3.4-3.6Z" fill="${C.eye}"/>
<path d="M14 20.6c.5-.7 1.2-1 2-1s1.5.3 2 1c-.5.6-1.2 1-2 1s-1.5-.4-2-1Z" fill="${C.tongue}"/>
</svg>
`;

async function shot(page, { w, h, body, bg = 'transparent', out }) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><head><style>
    html,body{margin:0;width:${w}px;height:${h}px;background:${bg};overflow:hidden}
    #b{width:${w}px;height:${h}px;display:grid;place-items:center} svg{display:block} ${CLEAN_CSS}
  </style></head><body><div id="b">${body}</div></body></html>`);
  await page.waitForTimeout(50);
  await page.screenshot({
    path: path.join(BRAND, out),
    omitBackground: bg === 'transparent',
    clip: { x: 0, y: 0, width: w, height: h },
  });
  console.log(out);
}

(async () => {
  fs.writeFileSync(path.join(BRAND, 'favicon.svg'), FAVICON);
  console.log('favicon.svg');
  const b = await chromium.launch();
  const page = await b.newPage({ deviceScaleFactor: 1 });
  const sized = (svg, s) => svg.replace('<svg ', `<svg width="${s}" height="${s}" `);

  await shot(page, { w: 32, h: 32, out: 'favicon-32.png', body: sized(FAVICON, 32) });
  // иконка iOS: монета ≈ 80 % стороны, iOS сам скругляет углы
  await shot(page, {
    w: 180,
    h: 180,
    bg: C.cream,
    out: 'apple-touch-icon-180.png',
    body: sized(emotion('privet', { clean: true, viewBox: COIN_BOX }), 146),
  });
  // аватар: монета в край — внешний контур монеты совпадает с кругом аватара
  await shot(page, {
    w: 640,
    h: 640,
    bg: C.outline,
    out: 'bot-avatar-640.png',
    body: sized(emotion('privet', { clean: true, viewBox: COIN_BOX }), 640),
  });
  // картинка Mini App: монета 240 px, сверху и снизу поле по ¼ монеты (60 px)
  await shot(page, {
    w: 640,
    h: 360,
    bg: C.cream,
    out: 'miniapp-640x360.png',
    body: sized(emotion('privet', { viewBox: COIN_BOX }), 240),
  });
  await b.close();
})();
