// Детерминированная съёмка Playwright (Chromium).
//   node capture.cjs static           → frames/static/<emotion>.png (600×600)
//   node capture.cjs scenes [id...]   → frames/<scene>/fNNN.png (480×480), шаг 40 мс = 25 к/с
//   node capture.cjs page             → frames/page.png (демо-страница, мобильная ширина 375)
// SMIL: svg.pauseAnimations() + svg.setCurrentTime(t).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, 'preview');
const WEB = path.join(__dirname, '../../../web/public/brand/mascot');
const data = JSON.parse(fs.readFileSync(path.join(DIR, 'data.json'), 'utf8'));

async function load(page, file, w, h, bg = '#ffffff') {
  const svg = fs.readFileSync(file, 'utf8');
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:${bg}">
    <div id="b" style="width:${w}px;height:${h}px">${svg.replace('<svg ', `<svg width="${w}" height="${h}" `)}</div></body></html>`);
}

(async () => {
  const [mode, ...ids] = process.argv.slice(2);
  const b = await chromium.launch();
  const page = await b.newPage({ deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text());
  });
  if (mode === 'static') {
    fs.mkdirSync(path.join(DIR, 'frames/static'), { recursive: true });
    for (const e of data.emotions) {
      await load(page, `${WEB}/emotions/${e.id}.svg`, 600, 600);
      await page.locator('#b').screenshot({ path: `${DIR}/frames/static/${e.id}.png` });
    }
    console.log('static ok', errs.join(' | '));
  } else if (mode === 'scenes') {
    const list = data.scenes.filter((s) => !ids.length || ids.includes(s.id));
    for (const s of list) {
      const out = `${DIR}/frames/${s.id}`;
      fs.rmSync(out, { recursive: true, force: true });
      fs.mkdirSync(out, { recursive: true });
      await load(page, `${WEB}/scenes/${s.id}.svg`, 480, 480);
      let i = 0;
      for (let t = 0; t < s.dur; t += 40) {
        await page.evaluate((t) => {
          const v = document.querySelector('svg');
          v.pauseAnimations();
          v.setCurrentTime(t / 1000);
        }, t);
        await page.locator('#b').screenshot({ path: `${out}/f${String(i++).padStart(3, '0')}.png` });
      }
      // ключевые кадры для scenes.png
      for (const t of s.keyt) {
        await page.evaluate((t) => {
          const v = document.querySelector('svg');
          v.pauseAnimations();
          v.setCurrentTime(t / 1000);
        }, t);
        await page.locator('#b').screenshot({ path: `${out}/k${String(t).padStart(5, '0')}.png` });
      }
      console.log(s.id, s.dur, 'мс', i, 'кадров', errs.join(' | '));
    }
  } else if (mode === 'page') {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('file://' + path.join(DIR, 'index.html'));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${DIR}/frames/page.png`, fullPage: true });
    // переход: нажать «Злится», дождаться и снять сцену
    await page.locator('.thumb').nth(10).click();
    await page.waitForTimeout(900);
    await page.locator('.stage').screenshot({ path: `${DIR}/frames/page_zlitsya.png` });
    await page.locator('.thumb').nth(13).click();
    await page.waitForTimeout(900);
    await page.locator('.stage').screenshot({ path: `${DIR}/frames/page_lyubov.png` });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    console.log('page ok, scrollWidth', sw, errs.join(' | '));
  }
  await b.close();
})();
