"""Экспорт мастеров в стикеры Telegram и картинки для приложения.

Запуск (из корня репозитория, после cutout.py):
  uv run --with pillow --with numpy python design/mascot/tools/export.py
Выход:
  design/mascot/stickers/<имя>.webp|.png  512x512, прозрачные (webp <=150 КБ, png <=512 КБ)
  web/public/brand/mascot/<имя>.webp         512x512, прозрачный, <=60 КБ (подбор качества)
"""
import io
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
MAS = ROOT / "design/mascot/masters"
STK = ROOT / "design/mascot/stickers"
APP = ROOT / "web/public/brand/mascot"


def webp_under(img, limit):
    for q in range(95, 20, -3):
        buf = io.BytesIO()
        img.save(buf, "WEBP", quality=q, method=6, alpha_quality=min(q + 5, 100))
        if buf.tell() <= limit:
            return buf.getvalue(), q
    return buf.getvalue(), q


for d in (STK, APP):
    d.mkdir(parents=True, exist_ok=True)
for p in sorted(MAS.glob("*.png")):
    im = Image.open(p).convert("RGBA").resize((512, 512), Image.LANCZOS)
    data, q = webp_under(im, 150 * 1024)
    (STK / f"{p.stem}.webp").write_bytes(data)
    im.save(STK / f"{p.stem}.png", optimize=True)
    if (STK / f"{p.stem}.png").stat().st_size > 512 * 1024:
        im.quantize(256, method=Image.FASTOCTREE).save(STK / f"{p.stem}.png", optimize=True)
    data2, q2 = webp_under(im, 60 * 1024)
    (APP / f"{p.stem}.webp").write_bytes(data2)
    print(p.stem, "sticker q", q, "app q", q2)
