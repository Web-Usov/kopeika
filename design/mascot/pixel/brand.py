# Бренд-ассеты Копейки в пикселе: favicon, apple-touch, аватар бота, картинка Mini App.
# Запуск из корня репозитория:
#   uv run --with pillow python design/mascot/pixel/brand.py
import math
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.join(ROOT, 'web', 'public', 'brand')
sys.path.insert(0, HERE)
import sprite as S  # noqa: E402

CREAM = (0xF6, 0xEC, 0xDC)
DARK = (0x17, 0x21, 0x2B)
P = S.P


def up(im, k):
    return im.resize((im.width * k, im.height * k), Image.NEAREST)


def hexc(c):
    return '#%02X%02X%02X' % c


# ---------- favicon 16x16: лицо-монетка ----------
N = 16


def favicon_pixels():
    px = {}
    c = (N - 1) / 2
    for y in range(N):
        for x in range(N):
            r = math.hypot(x - c, y - c)
            if r <= 7.6:
                if r > 6.5:
                    px[(x, y)] = 'O'
                elif r > 5.0:
                    d = (x - c) + (y - c)
                    px[(x, y)] = 'L' if d < -4 else ('D' if d > 4 else 'M')
                else:
                    px[(x, y)] = 'M'
    # глаза: белок 2x3 с зрачком и бликом
    for ex in (4, 9):
        for dx in (0, 1):
            for dy in (0, 1, 2):
                px[(ex + dx, 5 + dy)] = 'W'
        px[(ex + 1, 6)] = 'K'
        px[(ex + 1, 7)] = 'K'
    # улыбка
    for x in (5, 10):
        px[(x, 10)] = 'K'
    for x in (6, 7, 8, 9):
        px[(x, 11)] = 'K'
    # румянец
    px[(3, 9)] = 'T'
    px[(12, 9)] = 'T'
    return px


def favicon_img(px):
    im = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    for (x, y), c in px.items():
        im.putpixel((x, y), P[c] + (255,))
    return im


def favicon_svg(px):
    rects = []
    for y in range(N):
        x = 0
        while x < N:
            c = px.get((x, y))
            if c is None:
                x += 1
                continue
            x2 = x
            while px.get((x2 + 1, y)) == c:
                x2 += 1
            rects.append((c, x, y, x2 - x + 1))
            x = x2 + 1
    by = {}
    for c, x, y, w in rects:
        by.setdefault(c, []).append((x, y, w))
    out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d" shape-rendering="crispEdges">' % (N, N, N * 2, N * 2),
           '<title>Копейка</title>']
    for c, items in by.items():
        out.append('<g fill="%s">' % hexc(P[c]))
        for x, y, w in items:
            out.append('<rect x="%d" y="%d" width="%d" height="1"/>' % (x, y, w) if w > 1 else
                       '<rect x="%d" y="%d" width="1" height="1"/>' % (x, y))
        out.append('</g>')
    out.append('</svg>')
    return '\n'.join(out)


# ---------- фигура «Привет» ----------
def figure():
    lay = S.compose('greet')
    im = S.render(lay)
    return im.crop(im.getbbox())


def spark_img(big=True):
    lay = S.spark(3, 3, big)
    im = Image.new('RGBA', (7, 7), (0, 0, 0, 0))
    for (x, y), c in lay.items():
        im.putpixel((x, y), P[c] + (255,))
    return im.crop(im.getbbox())


def mini_coin():
    """Маленькая монетка 9x9 для узора."""
    m = ['..OOOOO..', '.OLLMMMO.', 'OLMMMMMDO', 'OLMEEEMDO', 'OMMEMEMDO', 'OMMEEEMDO', 'OMMMMMDDO', '.ODDDDDO.', '..OOOOO..']
    im = Image.new('RGBA', (9, 9), (0, 0, 0, 0))
    for j, row in enumerate(m):
        for i, ch in enumerate(row):
            if ch != '.':
                im.putpixel((i, j), P[ch] + (255,))
    return im


def place(canvas, im, x, y, k):
    canvas.alpha_composite(up(im, k), (x, y))


def centered(canvas, im, k, cx, cy):
    place(canvas, im, cx - im.width * k // 2, cy - im.height * k // 2, k)


# apple-touch 180: фигура x3 (≈ 150 по высоте) -> поля ~10%; лицо крупнее выглядело бы лучше
def apple_touch():
    c = Image.new('RGBA', (180, 180), CREAM + (255,))
    fig = figure()
    k = 3
    while fig.height * k > 180 * 0.8:
        k -= 1
    centered(c, fig, k, 90, 90)
    return c


def avatar():
    """Поясной кадр: лицо-монета и машущая рука крупно, ножки уходят за круг."""
    c = Image.new('RGBA', (640, 640), CREAM + (255,))
    im = S.render(S.compose('greet'))
    k = 12
    cx, cy = 285, 285   # центр лица чуть выше центра круга
    place(c, im, cx - 28 * k, cy - 28 * k, k)
    for x, y in ((120, 150), (535, 440)):
        centered(c, spark_img(True), 4, x, y)
    return c


def miniapp():
    c = Image.new('RGBA', (640, 360), CREAM + (255,))
    fig = figure()
    k = 6
    deco = [(70, 70, 'c', 4), (110, 300, 's', 4), (570, 70, 'c', 4), (560, 300, 's', 4), (60, 200, 's', 3), (590, 215, 'c', 3),
            (200, 50, 's', 3), (440, 40, 's', 3)]
    for x, y, t, kk in deco:
        centered(c, mini_coin() if t == 'c' else spark_img(t == 's'), kk, x, y)
    centered(c, fig, k, 320, 180)
    return c


def circle_mask(im):
    m = Image.new('L', im.size, 0)
    ImageDraw.Draw(m).ellipse((0, 0, im.width - 1, im.height - 1), fill=255)
    out = Image.new('RGBA', im.size, (60, 60, 64, 255))
    out.paste(im, (0, 0), m)
    return out


def main():
    px = favicon_pixels()
    fav = favicon_img(px)
    svg = favicon_svg(px)
    open(os.path.join(OUT, 'favicon.svg'), 'w', encoding='utf-8').write(svg)
    up(fav, 2).save(os.path.join(OUT, 'favicon-32.png'))
    at, av, ma = apple_touch(), avatar(), miniapp()
    at.convert('RGB').save(os.path.join(OUT, 'apple-touch-icon-180.png'))
    av.convert('RGB').save(os.path.join(OUT, 'bot-avatar-640.png'))
    ma.convert('RGB').save(os.path.join(OUT, 'miniapp-640x360.png'))

    # превью
    pv = Image.new('RGBA', (1000, 1100), (0xEE, 0xEE, 0xEE, 255))
    d = ImageDraw.Draw(pv)
    x = 20
    for bg in ((255, 255, 255), CREAM, DARK):
        pass
    y = 20
    for bg, lab in (((255, 255, 255), 'light'), (DARK, 'dark')):
        pv.paste(Image.new('RGBA', (460, 110), bg + (255,)), (20 if bg[0] == 255 else 500, y))
    xs = {255: 20, 0x17: 500}
    for bg in ((255, 255, 255), DARK):
        x0 = 20 if bg[0] == 255 else 500
        xx = x0 + 20
        for s in (1, 2, 4):
            im = fav if s == 1 else up(fav, s)
            pv.alpha_composite(im, (xx, y + 20))
            xx += im.width + 24
        # 32 px настоящий и 64
        pv.alpha_composite(up(fav, 2), (xx, y + 20)); xx += 56
        pv.alpha_composite(up(fav, 4), (xx, y + 20))
    d.text((20, y + 112), 'favicon x1 / x2 / x4, then the 32 px file and x4; light and dark', fill=(60, 60, 60))
    pv.alpha_composite(at, (20, 170))
    pv.alpha_composite(circle_mask(av).resize((320, 320), Image.NEAREST), (230, 170))
    for i, sz in enumerate((128, 64, 40)):
        pv.alpha_composite(circle_mask(av).resize((sz, sz), Image.LANCZOS), (570 + [0, 150, 240][i], 170))
        d.text((570 + [0, 150, 240][i], 175 + sz), str(sz), fill=(60, 60, 60))
    pv.alpha_composite(ma, (20, 520))
    d.text((20, 355), 'apple-touch 180', fill=(60, 60, 60))
    d.text((230, 495), 'avatar with circle mask (320; 128 / 64 / 40 right)', fill=(60, 60, 60))
    d.text((20, 890), 'miniapp 640x360', fill=(60, 60, 60))
    pv.crop((0, 0, 1000, 910)).convert('RGB').save(os.path.join(HERE, 'preview', 'brand.png'))


main()
