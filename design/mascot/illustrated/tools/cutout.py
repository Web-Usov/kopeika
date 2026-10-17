"""Вырезает фон и тень из черновиков образов Копейки -> мастер-файлы с прозрачностью.

Запуск (из корня репозитория):
  uv run --with pillow --with numpy --with scipy python design/mascot/tools/cutout.py
Вход:  design/mascot/emotions/*.png   Выход: design/mascot/masters/*.png (квадрат, поля 4%)
Превью на тёмном/светлом фоне: /private/tmp/claude-502/kopeika-stream1/preview/
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[4]
SRC = ROOT / "design/mascot/illustrated/emotions"
DST = ROOT / "design/mascot/illustrated/masters"
PREV = Path("/private/tmp/claude-502/kopeika-stream1/preview")
SIZE = 1600  # итоговая сторона мастера
PAD = 0.04
# замкнутые просветы фона (между рукой и корпусом) — координаты в исходных 1254 px.
# Белки глаз и зубы остаются непрозрачными: они не связаны с краем кадра.
HOLES = {"3_thinking": [(922, 734)], "5_error": [(981, 365)]}


def cut(path: Path) -> Image.Image:
    im = Image.open(path).convert("RGB").resize((2508, 2508), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    # фон и тень: светлые, с высоким синим каналом (медь/золото/контур — низкий B)
    light = b > 167
    lab, n = ndi.label(light)
    ids = set(np.unique(np.r_[lab[0], lab[-1], lab[:, 0], lab[:, -1]])) - {0}
    for x, y in HOLES.get(path.stem, []):
        ids.add(int(lab[y * 2, x * 2]) or -1)
    bg = np.isin(lab, list(ids))
    fg = ~bg
    # убрать мелкий мусор (кроме реального конфетти: порог по площади маленький)
    lab, n = ndi.label(fg)
    sizes = ndi.sum(fg, lab, range(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes > 400
    fg2 = keep[lab]
    # сузить на 1px (убирает смешанный с фоном край), затем чуть сгладить
    fg2 = ndi.binary_erosion(fg2, iterations=1)
    al = Image.fromarray((fg2 * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))
    al = np.asarray(al).astype(np.float32) / 255
    # цвет: у края берём цвет ближайшего «чистого» пикселя (без примеси фона)
    core = ndi.binary_erosion(fg2, iterations=3)
    idx = ndi.distance_transform_edt(~core, return_distances=False, return_indices=True)
    col = a[idx[0], idx[1]]
    out = np.dstack([col, al * 255]).astype(np.uint8)
    img = Image.fromarray(out, "RGBA")
    bbox = img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    img = img.crop(bbox)
    w, h = img.size
    side = max(w, h)
    pad = int(side * PAD / (1 - 2 * PAD))
    canvas = Image.new("RGBA", (side + 2 * pad,) * 2, (0, 0, 0, 0))
    canvas.paste(img, ((canvas.width - w) // 2, (canvas.height - h) // 2))
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def preview(img: Image.Image, name: str):
    PREV.mkdir(parents=True, exist_ok=True)
    for tag, c in (("dark", (0x17, 0x21, 0x2B)), ("light", (255, 255, 255))):
        bg = Image.new("RGBA", img.size, c + (255,))
        bg.alpha_composite(img)
        bg.convert("RGB").resize((800, 800), Image.LANCZOS).save(PREV / f"{name}_{tag}.png")


if __name__ == "__main__":
    DST.mkdir(parents=True, exist_ok=True)
    for p in sorted(SRC.glob("*.png")):
        m = cut(p)
        m.save(DST / p.name, optimize=True)
        preview(m, p.stem)
        print("ok", p.name)
