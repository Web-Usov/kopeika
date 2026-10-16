"""Векторизация мастеров в SVG (vtracer, цветной режим) + проверка на 128 px.

Запуск (из корня репозитория):
  uv run --with pillow --with numpy --with vtracer --with cairosvg python design/mascot/tools/vectorize.py [out_dir]
  затем: npx --yes svgo --multipass -p 1 -f <in_dir> -o <новая_папка>
По умолчанию пишет в design/mascot/svg-attempts/. Вход — трейсинг 1024 px-версии мастера
с ограниченной палитрой (квантование до 28 цветов, альфа — бинарная).
"""
import sys
from pathlib import Path
import numpy as np
import vtracer
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
MAS = ROOT / "design/mascot/masters"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "design/mascot/svg-attempts"
TMP = Path("/private/tmp/claude-502/kopeika-stream1")
OUT.mkdir(parents=True, exist_ok=True)
for p in sorted(MAS.glob("*.png")):
    im = Image.open(p).convert("RGBA").resize((1024, 1024), Image.LANCZOS)
    a = np.asarray(im.getchannel("A")) > 127
    q = im.convert("RGB").quantize(28, method=Image.MEDIANCUT, dither=Image.NONE).convert("RGB")
    arr = np.asarray(q)
    rgba = np.dstack([arr, a * 255]).astype(np.uint8)
    src = TMP / f"{p.stem}_q.png"
    Image.fromarray(rgba, "RGBA").save(src)
    vtracer.convert_image_to_svg_py(
        str(src), str(OUT / f"{p.stem}.svg"), colormode="color", hierarchical="stacked",
        mode="spline", filter_speckle=8, color_precision=6, layer_difference=16,
        corner_threshold=60, length_threshold=4.0, max_iterations=10, splice_threshold=45, path_precision=1,
    )
    print(p.stem, (OUT / f"{p.stem}.svg").stat().st_size // 1024, "KB")
