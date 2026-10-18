"""Контакт-листы и GIF из кадров capture.cjs.

    uv run --with pillow python sheets.py    → sheet.png, scenes.png, gif/<сцена>.gif, gif/<сцена>_strip.png
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent / "preview"
DATA = json.loads((HERE / "data.json").read_text())
FONT = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"
BG, INK, MUTED, ACC = (255, 255, 255), (42, 26, 16), (138, 118, 102), (196, 110, 10)


def font(sz):
    return ImageFont.truetype(FONT, sz)


def sheet():
    cell, cols, pad, lab = 300, 6, 16, 80
    items = DATA["emotions"]
    rows = (len(items) + cols - 1) // cols
    W, H = cols * (cell + pad) + pad, 70 + rows * (cell + lab + pad) + pad
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((pad, 18), "Копейка — единый риг: эмоции (лицо A + эффекты B + блеск C)", fill=INK, font=font(30))
    for i, e in enumerate(items):
        x = pad + (i % cols) * (cell + pad)
        y = 70 + (i // cols) * (cell + lab + pad)
        pic = Image.open(HERE / f"frames/static/{e['id']}.png").convert("RGB").resize((cell, cell), Image.LANCZOS)
        im.paste(pic, (x, y))
        d.text((x + cell / 2, y + cell + 2), e["label"], fill=INK, font=font(24), anchor="ma")
        d.text((x + cell / 2, y + cell + 31), e["use"], fill=MUTED, font=font(15), anchor="ma")
        fx = " · ".join(e["fx"])
        d.text((x + cell / 2, y + cell + 52), fx, fill=ACC, font=font(13 if len(fx) < 44 else 11), anchor="ma")
    im.save(HERE / "sheet.png", optimize=True)


def scenes():
    cell, pad, lab_w = 220, 10, 210
    sc = DATA["scenes"]
    cols = max(len(s["keyt"]) for s in sc)
    W = lab_w + cols * (cell + pad) + pad
    H = 60 + len(sc) * (cell + 26 + pad) + pad
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((pad, 14), "Копейка — сцены, ключевые кадры (SMIL)", fill=INK, font=font(28))
    for r, s in enumerate(sc):
        y = 60 + r * (cell + 26 + pad)
        d.text((pad, y + 70), s["label"], fill=INK, font=font(24))
        d.text((pad, y + 102), f"{s['dur'] / 1000:g} с", fill=MUTED, font=font(16))
        d.multiline_text((pad, y + 126), s["note"].replace(", ", ",\n"), fill=MUTED, font=font(14))
        for c, t in enumerate(s["keyt"]):
            x = lab_w + c * (cell + pad)
            pic = Image.open(HERE / f"frames/{s['id']}/k{t:05d}.png").convert("RGB").resize((cell, cell), Image.LANCZOS)
            im.paste(pic, (x, y))
            d.text((x + 4, y + cell + 2), f"{t} мс", fill=MUTED, font=font(14))
    im.save(HERE / "scenes.png", optimize=True)


def gifs():
    (HERE / "gif").mkdir(exist_ok=True)
    for s in DATA["scenes"]:
        fs = sorted((HERE / "frames" / s["id"]).glob("f*.png"))
        if not fs:
            continue
        ims = [Image.open(f).convert("RGB") for f in fs]
        small = [im.resize((360, 360), Image.LANCZOS) for im in ims]
        pal = [im.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for im in small]
        pal[0].save(HERE / f"gif/{s['id']}.gif", save_all=True, append_images=pal[1:], duration=40, loop=0,
                    disposal=1, optimize=False)
        pick = ims[::3]
        cols = 10
        rows = (len(pick) + cols - 1) // cols
        st = Image.new("RGB", (cols * 180, rows * 180), BG)
        for i, im in enumerate(pick):
            st.paste(im.resize((180, 180), Image.LANCZOS), ((i % cols) * 180, (i // cols) * 180))
        st.save(HERE / f"gif/{s['id']}_strip.png", optimize=True)
        print(s["id"], len(ims))


if __name__ == "__main__":
    sheet()
    scenes()
    gifs()
