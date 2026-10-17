"""Трассировка мастеров в SVG: палитра + potrace по накопительным слоям.

Запуск (из корня репозитория, после cutout.py):
  uv run --with potracer --with numpy --with pillow python design/mascot/tools/trace.py [имена]
  npx --yes svgo --config design/mascot/tools/svgo.config.mjs -f web/public/brand/mascot
Выход:
  web/public/brand/mascot/<имя>.svg  ~30–40 КБ после svgo

Как работает:
  1. Мастер уменьшается до 800 px и сглаживается медианным фильтром (убирает шум генерации).
  2. Каждый пиксель приводится к палитре: опорные цвета гайда уточняются k-means по рисунку;
     язык, белки и цвет глаз зафиксированы, иначе они сливаются с соседними тонами.
  3. Цвета сортируются от тёмного к светлому. Слой i — все пиксели цвета i и светлее;
     слои кладутся стопкой снизу вверх, поэтому между цветами нет щелей.
  4. Каждый слой обводится potrace (гладкие кривые Безье).
"""

import sys
from pathlib import Path

import numpy as np
import potrace
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[3]
SIZE = 800
SEEDS = [
    "#311202",  # глаза, рот
    "#682E0D",  # контур
    "#994917",  # торец
    "#A9521C",  # линии ободка
    "#B45A20",  # тёмная медь
    "#C9702F",  # полоса ободка
    "#D97E3A",  # основная медь
    "#E08C4C",  # точки ободка
    "#F9BC80",  # блик
    "#FFF8EE",  # белки, зубы
    "#D86E3F",  # язык
    "#F2B233",  # золото: искорки, конфетти
]
FROZEN = {"#311202", "#FFF8EE", "#D86E3F"}
TITLES = {
    "1_greeting": "Копейка машет рукой",
    "2_settled": "Копейка радуется: все в расчёте",
    "3_thinking": "Копейка задумалась",
    "4_worried": "Копейка встревожена",
    "5_error": "Копейка смущённо чешет затылок",
    "6_celebrate": "Копейка прыгает от радости, вокруг конфетти",
}


def hex2rgb(h):
    return [int(h[i : i + 2], 16) for i in (1, 3, 5)]


def path_d(curves):
    out = []
    for c in curves:
        s = [f"M{c.start_point.x:.0f} {c.start_point.y:.0f}"]
        for seg in c.segments:
            e = seg.end_point
            if seg.is_corner:
                s.append(f"L{seg.c.x:.0f} {seg.c.y:.0f}L{e.x:.0f} {e.y:.0f}")
            else:
                s.append(f"C{seg.c1.x:.0f} {seg.c1.y:.0f} {seg.c2.x:.0f} {seg.c2.y:.0f} {e.x:.0f} {e.y:.0f}")
        out.append("".join(s) + "z")
    return "".join(out)


def trace(name):
    im = Image.open(ROOT / f"design/mascot/masters/{name}.png").convert("RGBA").resize((SIZE, SIZE), Image.LANCZOS)
    alpha = np.array(im)[:, :, 3] > 128
    bg = Image.new("RGBA", im.size, (104, 46, 13, 255))  # фон под контур, чтобы край не светлел
    bg.alpha_composite(im)
    rgb = bg.convert("RGB").filter(ImageFilter.MedianFilter(5))

    pal = np.array([hex2rgb(h) for h in SEEDS], float)
    px = np.array(rgb).reshape(-1, 3).astype(float)
    on = alpha.reshape(-1)
    for _ in range(8):
        a = ((px[on][:, None, :] - pal[None]) ** 2).sum(-1).argmin(1)
        for k, h in enumerate(SEEDS):
            if h not in FROZEN and (a == k).any():
                pal[k] = px[on][a == k].mean(0)
    idx = ((px[:, None, :] - pal[None]) ** 2).sum(-1).argmin(1).reshape(SIZE, SIZE)
    pal = pal.round().astype(int)

    order = np.argsort(pal @ np.array([0.299, 0.587, 0.114]))  # тёмные первыми
    rank = np.empty(len(pal), int)
    rank[order] = np.arange(len(pal))
    rk = np.where(alpha, rank[idx], -1)

    layers = []
    for r in range(len(pal)):
        mask = rk >= r
        if mask.sum() < 30:
            continue
        color = "#%02X%02X%02X" % tuple(pal[order[r]])
        curves = potrace.Bitmap(~mask).trace(turdsize=12, alphamax=1.0, opticurve=True, opttolerance=0.4)
        layers.append(f'<path fill="{color}" fill-rule="evenodd" d="{path_d(curves)}"/>')
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}">'
        f"<title>{TITLES[name]}</title>{''.join(layers)}</svg>\n"
    )
    out = ROOT / f"web/public/brand/mascot/{name}.svg"
    out.write_text(svg, encoding="utf-8")
    print(f"{len(svg.encode()) // 1024:4d} КБ  {out.relative_to(ROOT)}")


if __name__ == "__main__":
    for n in sys.argv[1:] or list(TITLES):
        trace(n)
