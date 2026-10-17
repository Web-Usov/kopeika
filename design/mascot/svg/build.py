"""Собирает SVG-образы Копейки из design/mascot/svg/poses/*.py.

  python3 design/mascot/svg/build.py            # все образы → web/public/brand/mascot/<имя>.svg
  python3 design/mascot/svg/build.py 3_thinking # только указанные

Сравнение с растровыми мастерами (нужны rsvg-convert и pillow):
  uv run --with pillow python design/mascot/svg/compare.py [имена] --out <папка>
"""

import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = ROOT / "web/public/brand/mascot"
sys.path.insert(0, str(HERE))
import rig  # noqa: E402


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / "poses" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def build(name):
    mod = load(name)
    pid = "k" + name.split("_")[0]
    svg = rig.document(mod.TITLE, mod.draw(rig, pid))
    out = OUT / f"{name}.svg"
    out.write_text(svg, encoding="utf-8")
    return out, len(svg.encode())


if __name__ == "__main__":
    names = sys.argv[1:] or sorted(p.stem for p in (HERE / "poses").glob("*.py"))
    OUT.mkdir(parents=True, exist_ok=True)
    for n in names:
        out, size = build(n)
        print(f"{size:6d} B  {out.relative_to(ROOT)}")
