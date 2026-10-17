"""Сравнение SVG с растровым мастером: слева мастер, справа SVG; снизу — SVG в 96 px на светлом и тёмном.

  uv run --with pillow python design/mascot/svg/compare.py [имена] --out /tmp/cmp
"""

import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
args = sys.argv[1:]
out = Path(args[args.index("--out") + 1]) if "--out" in args else Path("/tmp/kopeika-cmp")
names = [a for a in args if not a.startswith("--") and a != str(out)] or sorted(
    p.stem for p in (ROOT / "design/mascot/svg/poses").glob("*.py")
)
out.mkdir(parents=True, exist_ok=True)
for n in names:
    svg = ROOT / f"web/public/brand/mascot/{n}.svg"
    big, small = out / f"{n}_svg.png", out / f"{n}_svg96.png"
    subprocess.run(["rsvg-convert", "-w", "512", "-h", "512", str(svg), "-o", str(big)], check=True)
    subprocess.run(["rsvg-convert", "-w", "96", "-h", "96", str(svg), "-o", str(small)], check=True)
    m = Image.open(ROOT / f"design/mascot/masters/{n}.png").convert("RGBA").resize((512, 512), Image.LANCZOS)
    s = Image.open(big).convert("RGBA")
    t = Image.open(small).convert("RGBA")
    sheet = Image.new("RGBA", (1044, 636), "#ffffff")
    sheet.alpha_composite(m, (0, 0))
    sheet.alpha_composite(s, (532, 0))
    dark = Image.new("RGBA", (116, 116), "#17212b")
    sheet.alpha_composite(t, (10, 530))
    sheet.alpha_composite(dark, (126, 520))
    sheet.alpha_composite(t, (136, 530))
    sheet.convert("RGB").save(out / f"{n}_cmp.png")
    print(out / f"{n}_cmp.png")
