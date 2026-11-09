"""Стикеры Telegram из пиксельного атласа web/public/brand/mascot/kopeika.png.

Запуск (из корня репозитория, после build.py):
  uv run --with pillow --with imageio-ffmpeg python design/mascot/pixel/stickers.py
Выход (design/mascot/pixel/stickers/):
  <эмоция>.png, <эмоция>.webp  статичные 512×512, прозрачные (спрайт ×9, по центру)
  <эмоция>.webm                видеостикеры: VP9 с альфой, 512×512, 30 fps, ≤ 3 с, ≤ 256 КБ
Видео: эмоция → анимация из атласа; короткие петли повторяются, длинные ускоряются до 3 с.
"""

import json
import subprocess
import tempfile
from pathlib import Path

import imageio_ffmpeg
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "web/public/brand/mascot"
OUT = ROOT / "design/mascot/pixel/stickers"
SCALE, SIZE, FPS, MAX_MS = 9, 512, 30, 3000
VIDEO = {  # эмоция → анимация
    "greeting": "wave",
    "settled": "settled",
    "thinking": "thinking",
    "worried": "worried",
    "oops": "oops",
    "celebrate": "celebrate",
}

atlas = Image.open(SRC / "kopeika.png").convert("RGBA")
meta = json.loads((SRC / "kopeika.json").read_text())
cw, ch = meta["cell"]["w"], meta["cell"]["h"]


def sticker(x, y):
    cell = atlas.crop((x, y, x + cw, y + ch)).resize((cw * SCALE, ch * SCALE), Image.NEAREST)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.alpha_composite(cell, ((SIZE - cell.width) // 2, (SIZE - cell.height) // 2))
    return canvas


def timeline(frames):
    """Кадры анимации → список кадров по 1/FPS: короткие петли повторяем, длинные ускоряем."""
    total = sum(f["ms"] for f in frames)
    if total > MAX_MS:
        k, loops = MAX_MS / total, 1
    else:
        k, loops = 1.0, max(1, MAX_MS // total)
    seq, t = [], 0.0
    for _ in range(loops):
        for f in frames:
            t += f["ms"] * k
            while len(seq) < round(t * FPS / 1000):
                seq.append(f)
    return seq


OUT.mkdir(parents=True, exist_ok=True)
ff = imageio_ffmpeg.get_ffmpeg_exe()
for emo, anim in VIDEO.items():
    e = meta["emotions"][emo]
    img = sticker(e["x"], e["y"])
    img.save(OUT / f"{emo}.png", optimize=True)
    img.save(OUT / f"{emo}.webp", lossless=True)
    seq = timeline(meta["animations"][anim])
    with tempfile.TemporaryDirectory() as tmp:
        cache = {}
        for i, f in enumerate(seq):
            key = (f["x"], f["y"])
            cache.setdefault(key, sticker(*key)).save(f"{tmp}/{i:04d}.png")
        out = OUT / f"{emo}.webm"
        subprocess.run(
            [ff, "-v", "error", "-y", "-framerate", str(FPS), "-i", f"{tmp}/%04d.png",
             "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0",
             "-b:v", "0", "-crf", "30", "-an", "-metadata:s:v:0", "alpha_mode=1", str(out)],
            check=True,
        )
    print(f"{emo:10s} {anim:10s} {len(seq) / FPS:4.2f} с  webm {out.stat().st_size // 1024} КБ  "
          f"webp {(OUT / f'{emo}.webp').stat().st_size // 1024} КБ")
