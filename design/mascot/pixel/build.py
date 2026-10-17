#!/usr/bin/env python3
"""Пиксельная Копейка: кадры анимаций, атлас для приложения и превью для людей.

Запуск (из корня репозитория):
    uv run --with pillow python design/mascot/pixel/build.py

Что делает: берёт спрайты из sprite.py (данные, 56x54, 9 цветов), собирает 8 анимаций
(кадры + длительности) и 6 статичных эмоций.
Результат:
    web/public/brand/mascot/kopeika.png, kopeika-dark.png   атлас 1x, прозрачный фон, ячейки 56x54
    web/public/brand/mascot/kopeika.json                    {cell, animations, emotions}
    design/mascot/pixel/preview/sheet.png, frames.png       для людей
    design/mascot/pixel/preview/<анимация>.gif, all.gif     для людей (не идут в продукт)
Увеличение везде целым множителем, nearest-neighbor.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
from sprite import *  # noqa: E402,F401,F403

OUT = ROOT / 'web/public/brand/mascot'
PREV = HERE / 'preview'
OUT.mkdir(parents=True, exist_ok=True)
PREV.mkdir(parents=True, exist_ok=True)

CREAM = (0xF6, 0xEC, 0xDC)
BGC = (0xF6, 0xF1, 0xE9)
INK = (0x31, 0x12, 0x02)
GREY = (0x6B, 0x5A, 0x4A)
DK = (0x17, 0x21, 0x2B)
DARK = 'c'
FONT = '/System/Library/Fonts/Helvetica.ttc'


def font(sz, bold=False):
    try:
        return ImageFont.truetype(FONT, sz, index=1 if bold else 0)
    except OSError:
        return ImageFont.load_default()


def up(im, s):
    return im.resize((im.width * s, im.height * s), Image.NEAREST)


def on(im, bg):
    b = Image.new('RGBA', im.size, bg + (255,))
    b.alpha_composite(im)
    return b


def R_(lay, dark=False):
    return render(dark_variant(lay, DARK) if dark else lay)


# ---------------- кадры ----------------
SPARKS = [(7, 14, True), (47, 10, False), (28, 4, True), (4, 28, False), (50, 28, True)]


def sparks(lay, n, dy):
    for (x, y, big) in SPARKS[:n]:
        lay = over(lay, spark(x, y + dy // 2, big))
    return lay


def idle(dy=0, ox=0, blink=False):
    return compose('idle', dy=dy, ox=ox, blink=blink)


# idle: дыхание, взгляд в сторону, моргание. Ритм с долгими паузами.
IDLE = [(idle(0), 700), (idle(1), 350), (idle(1, ox=1), 800), (idle(0, ox=1), 350),
        (idle(0), 1100), (idle(0, blink=True), 90), (idle(0), 900)]

WAVE = [(compose('wave', t=t), ms) for t, ms in ((-1, 140), (0, 110), (1, 110), (2, 200), (1, 110), (0, 110))]

CELEB = [
    (compose('idle', kind='idle', arms='down'), 450),
    (compose('idle', kind='settled', arms='down', dy=1, sq=(1.06, 0.94)), 130),
    (sparks(compose('celebrate', dy=-3, t=0, air=True, sq=(0.96, 1.05)), 1, -3), 80),
    (sparks(compose('celebrate', dy=-6, t=1, air=True), 3, -6), 100),
    (sparks(compose('celebrate', dy=-8, t=1, air=True), 5, -8), 170),
    (sparks(compose('celebrate', dy=-5, t=0, air=True), 4, -5), 100),
    (sparks(compose('celebrate', dy=0, kind='celebrate', arms='out', sq=(1.08, 0.92)), 2, 0), 110),
    (compose('celebrate', kind='celebrate', arms='down', dy=0, sq=(1.03, 0.97)), 200),
]

_keys = [(1, False), (.7, False), (.4, False), (.1, False), (.4, True), (.7, True), (1, True),
         (.7, True), (.4, True), (.1, False), (.4, False), (.7, False)]
_dys = [0, -2, -4, -5, -4, -2, 0, -2, -4, -5, -4, -2]
_ms = [300, 70, 70, 80, 70, 70, 300, 70, 70, 80, 70, 70]
SPIN = [(spin_frame(s, b, dy), ms) for (s, b), dy, ms in zip(_keys, _dys, _ms)]

# settled: все в расчёте. Покачивание корпуса (ноги на месте), глаза закрыты, мерцают искры.
SP2 = [(10, 12, True), (46, 9, False), (50, 24, True), (6, 26, False)]


def twinkle(lay, on_idx):
    for i in on_idx:
        x, y, big = SP2[i]
        lay = over(lay, spark(x, y, big))
    return lay


def settled(dx, dy, sparks_on):
    base = compose('idle', kind='settled', arms='down', dy=dy)
    return twinkle(sway(base, dx), sparks_on)


SETTLED = [(settled(0, 0, [0]), 350), (settled(1, 0, [0, 1]), 300), (settled(1, 1, [1]), 350),
           (settled(0, 1, [1, 2]), 300), (settled(-1, 0, [2, 3]), 350), (settled(-1, 1, [3]), 300),
           (settled(0, 0, [3, 0]), 350), (settled(0, 0, []), 500)]


# thinking: монетки-мысли по одной, взгляд вверх, лёгкое покачивание
def thinking(n, dx=0, dy=0):
    base = compose('idle', kind='think', arms='thinkl', dy=dy,
                   extra=over(chin_arm(dy), thought_n(n)))
    return sway(base, dx) if dx else base


THINK = [(thinking(0), 450), (thinking(1), 400), (thinking(2), 400), (thinking(3), 600),
         (thinking(3, 1), 500), (thinking(3, 0, 1), 400), (thinking(3, -1), 500), (thinking(2), 300)]


# worried: нервная дрожь ±1 px, капля пота появляется и сползает, пауза
def worried(dx=0, drop=0, ddy=0):
    extra = sweat_drop(drop, ddy) if drop else None
    lay = compose('idle', kind='worry', arms='in', extra=extra)
    return {(x + dx, y): c for (x, y), c in lay.items()} if dx else lay


WORRY = [(worried(), 500), (worried(1, 1), 70), (worried(-1, 1), 70), (worried(1, 2), 70),
         (worried(-1, 2), 70), (worried(1, 3), 70), (worried(-1, 3, 3), 120), (worried(0, 3, 7), 280),
         (worried(0, 3, 11), 280), (worried(0, 0), 700)]


# oops: подскок от неожиданности, ладони вверх, «линии удивления» мигают
def oops(dy=0, air=False, sq=None, marks=True, kind='error'):
    extra = alarm_marks(dy // 2) if marks else None
    return compose('idle', kind=kind, arms='cheek', dy=dy, air=air, sq=sq, extra=extra)


OOPS = [(compose('idle', kind='idle', arms='down'), 400),
        (oops(0, sq=(1.05, 0.95)), 70),
        (oops(-3, True), 90), (oops(-5, True), 160), (oops(-2, True), 80),
        (oops(0, sq=(1.07, 0.93)), 110), (oops(0, marks=False), 160), (oops(0), 200),
        (oops(0, marks=False), 160), (oops(0), 300)]

ANIMS = {'idle': IDLE, 'wave': WAVE, 'celebrate': CELEB, 'spin': SPIN,
         'settled': SETTLED, 'thinking': THINK, 'worried': WORRY, 'oops': OOPS}
TITLES = {'idle': 'Покой', 'wave': 'Взмах', 'celebrate': 'Празднование', 'spin': 'Поворот на ребро (загрузка)',
          'settled': 'Всё в расчёте', 'thinking': 'Задумалась', 'worried': 'Неловко', 'oops': 'Ой, ошибка'}

EMOTIONS = [('greeting', compose('greet')),
            ('settled', compose('settled')),
            ('thinking', compose('think')),
            ('worried', compose('worry')),
            ('oops', compose('error')),
            ('celebrate', sparks(compose('celebrate', dy=-3, air=True), 5, -3))]
EMO_TITLES = ['Привет', 'Всё в расчёте', 'Задумалась', 'Неловко', 'Ой, ошибка', 'Ура!']

# ---------------- атлас ----------------
COLS = 8
uniq = {}      # ключ -> индекс ячейки
cells = []


def cell_of(lay):
    key = tuple(sorted(lay.items()))
    if key not in uniq:
        uniq[key] = len(cells)
        cells.append(lay)
    return uniq[key]


def xy(i):
    return {'x': (i % COLS) * W, 'y': (i // COLS) * H}


emo_json = {n: xy(cell_of(l)) for n, l in EMOTIONS}
anim_json = {}
for name, fr in ANIMS.items():
    anim_json[name] = [dict(xy(cell_of(l)), ms=ms) for l, ms in fr]

rows = (len(cells) + COLS - 1) // COLS
atlas = Image.new('RGBA', (COLS * W, rows * H), (0, 0, 0, 0))
atlas_d = Image.new('RGBA', atlas.size, (0, 0, 0, 0))
for i, l in enumerate(cells):
    p = (i % COLS * W, i // COLS * H)
    atlas.paste(R_(l), p)
    atlas_d.paste(R_(l, True), p)
atlas.save(OUT / 'kopeika.png', optimize=True)
atlas_d.save(OUT / 'kopeika-dark.png', optimize=True)
(OUT / 'kopeika.json').write_text(json.dumps(
    {'cell': {'w': W, 'h': H}, 'animations': anim_json, 'emotions': emo_json}, ensure_ascii=False, indent=2) + '\n')

# ---------------- превью: sheet ----------------
lays = [l for _, l in EMOTIONS]
Sx = 6
cw, ch = 400, 360
sheet = Image.new('RGBA', (cw * 3, 100 + ch * 2 + 500), BGC + (255,))
d = ImageDraw.Draw(sheet)
d.text((24, 20), 'Копейка · пиксель 56×54, 9 цветов', font=font(28, True), fill=(0x68, 0x2E, 0x0D))
d.text((24, 58), 'Шесть эмоций ×6, nearest-neighbor. Ниже: реальный размер 1× и 2× на светлом и тёмном фоне.',
       font=font(14), fill=GREY)
for i, lay in enumerate(lays):
    big = up(R_(lay), Sx)
    x0 = (i % 3) * cw + (cw - big.width) // 2
    y0 = 90 + (i // 3) * ch
    sheet.alpha_composite(big, (x0, y0))
    d.text(((i % 3) * cw + cw // 2, y0 + ch - 22), '%d  %s' % (i + 1, EMO_TITLES[i]), font=font(20, True), fill=INK, anchor='mm')
by = 100 + ch * 2 + 10
d.text((24, by), 'Реальный размер: 1× и 2×', font=font(15, True), fill=INK)


def strip(bg, scale, dark, x, y):
    w = (W * scale + 6) * 6 + 6
    sheet.alpha_composite(Image.new('RGBA', (w, H * scale + 10), bg + (255,)), (x, y))
    xx = x + 4
    for lay in lays:
        im = R_(lay, dark)
        sheet.alpha_composite(im if scale == 1 else up(im, scale), (xx, y + 5))
        xx += W * scale + 6
    return w


y = by + 28
w = strip(BGC, 1, False, 24, y)
strip(DK, 1, True, 24 + w + 20, y)
y2 = y + H + 30
strip(BGC, 2, False, 24, y2)
strip(DK, 2, True, 24, y2 + H * 2 + 20)
py0 = y2 + H * 4 + 60
for k, (c, nm) in enumerate([('O', 'контур'), ('E', 'торец'), ('D', 'тёмная'), ('M', 'медь'), ('L', 'светлая'),
                             ('K', 'глаза'), ('W', 'белки'), ('T', 'язык'), ('G', 'искры')]):
    xx = 24 + k * 130
    d.rectangle([xx, py0, xx + 24, py0 + 24], fill=P[c], outline=INK)
    d.text((xx + 30, py0 - 2), '#%02X%02X%02X' % P[c], font=font(12, True), fill=INK)
    d.text((xx + 30, py0 + 12), nm, font=font(11), fill=GREY)
sheet.crop((0, 0, sheet.width, py0 + 50)).convert('RGB').save(PREV / 'sheet.png')

# ---------------- превью: frames ----------------
FS = 3
fw, fh = W * FS + 12, H * FS + 12
maxn = max(len(f) for f in ANIMS.values())
fr = Image.new('RGBA', (maxn * fw + 40, 70 + len(ANIMS) * (fh + 60)), BGC + (255,))
d = ImageDraw.Draw(fr)
d.text((20, 18), 'Раскадровка · ×3 · номер кадра и длительность, мс', font=font(24, True), fill=(0x68, 0x2E, 0x0D))
for r, (name, frs) in enumerate(ANIMS.items()):
    y0 = 60 + r * (fh + 60)
    total = sum(ms for _, ms in frs)
    d.text((20, y0), '%s · %d кадров · %d мс' % (TITLES[name], len(frs), total), font=font(16, True), fill=INK)
    for i, (f, ms) in enumerate(frs):
        x = 20 + i * fw
        d.rectangle([x, y0 + 26, x + fw - 6, y0 + 26 + fh - 6], fill=(0xFB, 0xF8, 0xF2), outline=(0xE2, 0xD8, 0xCA))
        fr.alpha_composite(up(R_(f), FS), (x + 3, y0 + 29))
        d.text((x + 6, y0 + 30), str(i + 1), font=font(13, True), fill=(0x99, 0x49, 0x17))
        d.text((x + fw // 2 - 3, y0 + 26 + fh - 1), '%d мс' % ms, font=font(12), fill=GREY, anchor='mt')
fr.convert('RGB').save(PREV / 'frames.png')

# ---------------- превью: gif ----------------
pal_img = Image.new('RGB', (len(P) + 1, 1))
for i, c in enumerate(list(P.values()) + [CREAM]):
    pal_img.putpixel((i, 0), c)
PAL = pal_img.quantize(colors=len(P) + 1, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)


def q(im):
    return im.convert('RGB').quantize(palette=PAL, dither=Image.Dither.NONE)


def save_gif(path, ims, durs):
    qs = [q(i) for i in ims]
    qs[0].save(path, save_all=True, append_images=qs[1:], duration=durs, loop=0, optimize=False, disposal=1)


for name, frs in ANIMS.items():
    save_gif(PREV / (name + '.gif'), [up(on(R_(l), CREAM), 6) for l, _ in frs], [ms for _, ms in frs])

# all.gif: сетка 4x2, ×3, общий отсчёт 40 мс, 8 с
TICK, TOTAL = 40, 8000
order = list(ANIMS)


def frame_at(frs, t):
    loop = sum(ms for _, ms in frs)
    t %= loop
    for l, ms in frs:
        if t < ms:
            return l
        t -= ms
    return frs[-1][0]


GS = 3
tiles = {n: {} for n in order}
imgs, durs, prev_key = [], [], None
for t in range(0, TOTAL, TICK):
    lays_t = [frame_at(ANIMS[n], t) for n in order]
    key = tuple(id(l) for l in lays_t)
    if key == prev_key:
        durs[-1] += TICK
        continue
    prev_key = key
    g = Image.new('RGBA', (W * GS * 4, H * GS * 2), CREAM + (255,))
    for i, l in enumerate(lays_t):
        g.alpha_composite(up(R_(l), GS), ((i % 4) * W * GS, (i // 4) * H * GS))
    imgs.append(g)
    durs.append(TICK)
save_gif(PREV / 'all.gif', imgs, durs)

print('cell', W, H, 'atlas', atlas.size, 'cells used', len(cells))
for n, f in ANIMS.items():
    print(n, len(f), 'frames', sum(ms for _, ms in f), 'ms')
print('all.gif', (PREV / 'all.gif').stat().st_size // 1024, 'KB')
