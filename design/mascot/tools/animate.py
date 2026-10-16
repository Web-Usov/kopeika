#!/usr/bin/env python3
"""Анимации Копейки: рендер кадров из мастеров и кодирование.

Запуск (из корня репозитория):
    uv run --with pillow --with numpy --with imageio-ffmpeg python design/mascot/tools/animate.py
    # только часть образов:  ... animate.py greeting celebrate
    # ещё и контактные листы: ... animate.py --sheets /private/tmp/claude-502/kopeika-stream3

Что делает: мастер целиком двигается трансформациями (сдвиг, поворот вокруг точки у ступней,
squash & stretch с сохранением площади) + процедурные частицы. Рисунок не перерисовывается.
Результат:
    design/mascot/animations/stickers/<имя>.webm   VP9+alpha, 512x512, 30 fps (видеостикеры Telegram)
    design/mascot/animations/preview/<имя>.gif     256x256 на кремовом фоне, 20 fps
    design/mascot/animations/preview/all.gif       сетка 3x2, плитки по 128 px, 8 fps, 10 с
ffmpeg берётся из imageio_ffmpeg (в нём есть libvpx-vp9).
"""

import math
import random
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
MASTERS = ROOT / "design/mascot/masters"
OUT = ROOT / "design/mascot/animations"

# ───────────────────────── параметры движений ─────────────────────────
# Единицы: px на холсте 512x512; углы в градусах; время в секундах.
# Точка вращения и сжатия — между ступнями (низ фигуры по центру).
MOTION = {
    "greeting": dict(
        file="1_greeting.png", dur=2.0,
        tilt=5.5,            # ±° наклон влево-вправо, 1 цикл за петлю
        hop=16,              # высота подскока; 2 подскока за петлю
        squash=0.06,         # сжатие при приземлении
    ),
    "settled": dict(
        file="2_settled.png", dur=2.5,
        breath=0.025,        # дыхание: sy = 1 ± 2.5%, sx = 1/sy
        twinkle=0.22,        # искорки: масштаб ±22%, прозрачность 0.45..1
    ),
    "thinking": dict(
        file="3_thinking.png", dur=2.5,  # 2.5 вместо 3.0: all.gif на 10 с зацикливается чисто
        tilt=3.5,            # ±° покачивание, 1 цикл
        float=6,             # ±px парение, 1 цикл, сдвиг фазы 90°
    ),
    "worried": dict(
        file="4_worried.png", dur=2.0,
        shake=2.5,           # ±px по X
        shake_len=0.3,       # длительность дрожи, с
        shake_hz=10,
        shake_starts=(0.0, 1.0),
        shake_rot=0.8,       # ±° лёгкий поворот в такт
    ),
    "error": dict(
        file="5_error.png", dur=2.0,
        kick=10,             # начальный размах, °
        decay=3.0,           # затухание exp(-decay*t)
        hz=1.8,              # частота колебаний
        active=1.5,          # с; дальше пауза
    ),
    "celebrate": dict(
        file="6_celebrate.png", dur=2.5,
        hop=62,              # высота прыжка
        launch=(0.14, 0.50), # фаза взлёта и приземления (доли петли)
        sway=4,              # ±° покачивание в полёте
        confetti=20, life=0.8,
    ),
}
ORDER = ["greeting", "settled", "thinking", "worried", "error", "celebrate"]

SIZE = 512
SS = 2                    # суперсэмплинг
CS = SIZE * SS            # рабочий холст
BODY = 392 * SS           # размер мастера на холсте (мастер 1600 px, поле ~4%)
OX = (CS - BODY) // 2
OY = 102 * SS
PIVOT = (CS / 2, OY + BODY * 1536 / 1600)  # ступни: низ фигуры, центр
CREAM = (0xF6, 0xEC, 0xDC)

# Искорки в 2_settled: (центр x, центр y, полуразмер) в координатах мастера 1600
SPARKLES = [(165, 315, 75), (1420, 395, 80), (135, 905, 45), (1365, 990, 55)]


# ───────────────────────── математика движения ─────────────────────────
def ease(x):  # плавный 0..1
    x = min(max(x, 0.0), 1.0)
    return 0.5 - 0.5 * math.cos(math.pi * x)


def keys(p, kf):
    """Интерполяция по ключам [(p, value)] с косинусным easing."""
    for (p0, v0), (p1, v1) in zip(kf, kf[1:]):
        if p0 <= p <= p1:
            return v0 + (v1 - v0) * ease((p - p0) / (p1 - p0))
    return kf[-1][1]


def pose_greeting(p, m):
    tilt = m["tilt"] * math.sin(2 * math.pi * (p - 0.125))
    h = (p % 0.5) / 0.5
    dy, sy = 0.0, 1.0
    if h < 0.5:
        u = h / 0.5
        dy = -m["hop"] * 4 * u * (1 - u)
    s = m["squash"]
    sy = keys(h, [(0, 1), (0.06, 1 - s * 0.6), (0.14, 1 + 0.05), (0.32, 1.0), (0.5, 1 + 0.04),
                  (0.58, 1 - s), (0.72, 1 + s * 0.25), (0.86, 1.0), (1, 1)])
    return dict(dx=0, dy=dy, rot=tilt, sy=sy)


def pose_settled(p, m):
    return dict(dx=0, dy=0, rot=0, sy=1 + m["breath"] * math.sin(2 * math.pi * p))


def pose_thinking(p, m):
    return dict(dx=0, dy=-m["float"] * math.sin(2 * math.pi * p + math.pi / 2) + m["float"] * 0,
                rot=m["tilt"] * math.sin(2 * math.pi * p), sy=1)


def pose_worried(p, m):
    t = p * m["dur"]
    dx = rot = 0.0
    for s0 in m["shake_starts"]:
        u = (t - s0) / m["shake_len"]
        if 0 <= u < 1:
            env = math.sin(math.pi * u) ** 1.5
            w = math.sin(2 * math.pi * m["shake_hz"] * (t - s0))
            dx += m["shake"] * env * w
            rot += m["shake_rot"] * env * w
    return dict(dx=dx, dy=0, rot=rot, sy=1)


def pose_error(p, m):
    t = p * m["dur"]
    rot = 0.0
    if t < m["active"]:
        win = 1 - ease((t - (m["active"] - 0.35)) / 0.35)  # мягко гасим хвост
        rot = m["kick"] * math.exp(-m["decay"] * t) * math.sin(2 * math.pi * m["hz"] * t) * win
    return dict(dx=0, dy=0, rot=rot, sy=1)


def pose_celebrate(p, m):
    l0, l1 = m["launch"]
    dy = rot = 0.0
    if l0 <= p <= l1:
        u = (p - l0) / (l1 - l0)
        dy = -m["hop"] * 4 * u * (1 - u)
        rot = m["sway"] * math.sin(2 * math.pi * u)
    # растяжение в полёте ≤ 5%, сжатие только при приземлении (3–4 кадра), ≤ 10%
    sy = keys(p, [(0, 1), (0.14, 1), (0.20, 1.05), (0.32, 1.02), (0.47, 1.05), (0.50, 1.04),
                  (0.535, 0.90), (0.58, 1.03), (0.65, 0.99), (0.72, 1.0), (1, 1)])
    return dict(dx=0, dy=dy, rot=rot, sy=sy)


POSES = dict(greeting=pose_greeting, settled=pose_settled, thinking=pose_thinking,
             worried=pose_worried, error=pose_error, celebrate=pose_celebrate)


# ───────────────────────── слои и композитинг ─────────────────────────
def premult(img):
    a = np.asarray(img.convert("RGBA"), dtype=np.float32)
    a[..., :3] *= a[..., 3:4] / 255.0
    return a


def to_layer(master, box=None):
    """Мастер → premult-слой на холсте CS×CS (опционально только область box в координатах мастера)."""
    im = master
    if box:
        x0, y0, x1, y1 = box
        mask = Image.new("L", im.size, 0)
        mask.paste(255, (x0, y0, x1, y1))
        im = im.copy()
        im.putalpha(Image.fromarray(np.minimum(np.asarray(im.getchannel("A")), np.asarray(mask))))
    im = im.resize((BODY, BODY), Image.LANCZOS)
    canvas = Image.new("RGBA", (CS, CS), (0, 0, 0, 0))
    canvas.paste(im, (OX, OY))
    return premult(canvas)


def affine(layer, dx=0.0, dy=0.0, rot=0.0, sx=1.0, sy=1.0, pivot=PIVOT, alpha=1.0):
    """out = pivot + d + R·S·(in − pivot); layer — premult float RGBA."""
    th = math.radians(rot)
    c, s = math.cos(th), math.sin(th)
    # M = R·S ; обратная: S⁻¹·R⁻¹
    m_inv = np.array([[c / sx, s / sx], [-s / sy, c / sy]])
    px, py = pivot
    tx, ty = px + dx * SS, py + dy * SS
    off = np.array([px, py]) - m_inv @ np.array([tx, ty])
    coeffs = (m_inv[0, 0], m_inv[0, 1], off[0], m_inv[1, 0], m_inv[1, 1], off[1])
    chans = []
    for i in range(4):
        ch = Image.fromarray(layer[..., i], mode="F")
        chans.append(np.asarray(ch.transform((CS, CS), Image.AFFINE, coeffs, Image.BICUBIC)))
    out = np.stack(chans, -1)
    out = np.clip(out, 0, 255)
    out[..., :3] = np.minimum(out[..., :3], out[..., 3:4])
    return out * alpha


def over(top, bottom):
    return top + bottom * (1 - top[..., 3:4] / 255.0)


def finish(premul):
    """premult CS×CS → straight RGBA 512×512 uint8 (даунсэмпл в premult)."""
    chans = [np.asarray(Image.fromarray(premul[..., i], mode="F").resize((SIZE, SIZE), Image.LANCZOS))
             for i in range(4)]
    a = np.clip(chans[3], 0, 255)
    rgb = np.where(a[..., None] > 0.5, np.stack(chans[:3], -1) * 255.0 / np.maximum(a[..., None], 1), 0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), a]).round().astype(np.uint8), "RGBA")


# ───────────────────────── частицы ─────────────────────────
CONFETTI_COLORS = ["#D97E3A", "#F9BC80", "#F2B233", "#D97E3A", "#F2B233"]
OUTLINE = "#B45A20"  # темнее не берём


def confetti_layer(p, m):
    """Веер из-за монеты в момент отрыва; потом медленное падение и угасание."""
    rng = random.Random(11)
    layer = Image.new("RGBA", (CS, CS), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    T, n = m["dur"], m["confetti"]
    cx, cy = 256 * SS, (OY + BODY * 0.45)  # старт: центр монеты, рисуем под телом
    t0 = m["launch"][0]
    for i in range(n):
        # углы поровну по вееру -165°..-15° с небольшим разбросом; скорости чередуются
        ang = math.radians(-165 + 150 * (i + 0.5) / n + rng.uniform(-3, 3))
        sp = (300, 420, 360, 480)[i % 4] * rng.uniform(0.92, 1.08)
        vx, vy = math.cos(ang) * sp, math.sin(ang) * sp * 0.8
        spin = rng.uniform(3, 7) * (1 if i % 2 else -1)
        flip = rng.uniform(3, 6)
        kind = ("rect", "rect", "dot", "rect", "star")[i % 5]
        col = CONFETTI_COLORS[i % len(CONFETTI_COLORS)]
        size = rng.uniform(15, 20)
        phase = rng.uniform(0, 6.28)
        sway = rng.uniform(8, 16)
        u = ((p - t0 - (i % 3) * 0.006) % 1.0) / m["life"]
        if u >= 1:
            continue
        tau = u * m["life"] * T
        k, g = 1.1, 230.0
        x = cx + (vx * (1 - math.exp(-k * tau)) / k + sway * math.sin(2.2 * tau + phase) * tau / 2) * SS
        y = cy + (vy * (1 - math.exp(-k * tau)) / k + 0.5 * g * tau * tau) * SS
        alpha = min(u / 0.05, (1 - u) / 0.3, 1.0)
        if alpha <= 0:
            continue
        rgba = _rgba(col, alpha)
        ol = _rgba(OUTLINE, alpha)
        r = size * SS
        if kind == "dot":
            d.ellipse([x - r * 0.4, y - r * 0.4, x + r * 0.4, y + r * 0.4], fill=rgba, outline=ol, width=SS)
        elif kind == "star":
            pts = []
            for j in range(10):
                rr = r * (0.7 if j % 2 == 0 else 0.3)
                a = spin * tau + j * math.pi / 5 - math.pi / 2
                pts.append((x + rr * math.cos(a), y + rr * math.sin(a)))
            d.polygon(pts, fill=rgba, outline=ol)
        else:
            w = r * 0.5 * abs(math.cos(flip * tau + phase)) + r * 0.1
            h = r * 0.9
            a = spin * tau + phase
            ca, sa = math.cos(a), math.sin(a)
            pts = [(x + ca * px - sa * py, y + sa * px + ca * py) for px, py in
                   [(-w, -h), (w, -h), (w, h), (-w, h)]]
            d.polygon(pts, fill=rgba, outline=ol)
    return premult(layer)


def _rgba(hexcol, alpha):
    h = hexcol.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), int(255 * alpha))


# ───────────────────────── рендер кадра ─────────────────────────
class Scene:
    def __init__(self, name):
        self.name, self.m = name, MOTION[name]
        master = Image.open(MASTERS / self.m["file"]).convert("RGBA")
        self.sparkles = []
        if name == "settled":
            body = master.copy()
            a = np.asarray(body.getchannel("A")).copy()
            for (x, y, r) in SPARKLES:
                box = (x - r - 6, y - r - 6, x + r + 6, y + r + 6)
                self.sparkles.append((to_layer(master, box), (OX + x / 1600 * BODY, OY + y / 1600 * BODY)))
                a[box[1]:box[3], box[0]:box[2]] = 0
            body.putalpha(Image.fromarray(a))
            master = body
        self.body = to_layer(master)

    def frame(self, p):
        m, name = self.m, self.name
        pose = POSES[name](p % 1.0, m)
        sy = pose["sy"]
        body = affine(self.body, pose["dx"], pose["dy"], pose["rot"], 1 / sy, sy)
        out = body
        if name == "settled":
            for i, (lay, c) in enumerate(self.sparkles):
                ph = i * 0.27
                w = 0.5 + 0.5 * math.sin(2 * math.pi * (p * 2 + ph))  # 2 мерцания за петлю
                s = 1 + m["twinkle"] * (2 * w - 1)
                al = 0.45 + 0.55 * w
                out = over(affine(lay, 0, 0, 0, s, s, pivot=c, alpha=al), out)
        if name == "celebrate":
            out = over(out, confetti_layer(p, m))
        return finish(out)


# ───────────────────────── кодирование ─────────────────────────
def ffmpeg_exe():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def encode_webm(frames, fps, path, max_kb=250):
    for crf in (30, 34, 38, 42, 46, 52):
        cmd = [ffmpeg_exe(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba",
               "-s", f"{SIZE}x{SIZE}", "-r", str(fps), "-i", "-", "-an", "-c:v", "libvpx-vp9",
               "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "0", "-crf", str(crf),
               "-deadline", "good", "-cpu-used", "1", "-row-mt", "1", "-metadata:s:v:0", "alpha_mode=1",
               str(path)]
        pr = subprocess.Popen(cmd, stdin=subprocess.PIPE)
        for f in frames:
            pr.stdin.write(np.asarray(f).tobytes())
        pr.stdin.close()
        pr.wait()
        kb = path.stat().st_size / 1024
        if kb <= max_kb:
            return crf, kb
    return crf, kb


def on_cream(img, size):
    bg = Image.new("RGBA", img.size, CREAM + (255,))
    bg.alpha_composite(img)
    return bg.convert("RGB").resize((size, size), Image.LANCZOS)


def save_gif(frames, fps, path, colors=128, dither=Image.FLOYDSTEINBERG):
    if dither == Image.NONE:  # общая палитра на все кадры: кадры лучше сжимаются разностью
        step = max(1, len(frames) // 12)
        sample = Image.new("RGB", (frames[0].width, frames[0].height * len(frames[::step])))
        for i, f in enumerate(frames[::step]):
            sample.paste(f, (0, i * f.height))
        q = sample.quantize(colors, method=Image.MEDIANCUT, dither=Image.NONE)
        pal = [f.quantize(palette=q, dither=Image.NONE) for f in frames]
    else:
        pal = [f.convert("P", palette=Image.ADAPTIVE, colors=colors, dither=dither) for f in frames]
    pal[0].save(path, save_all=True, append_images=pal[1:], duration=round(1000 / fps), loop=0,
                optimize=True, disposal=1)


def main():
    args = sys.argv[1:]
    sheets = None
    if "--sheets" in args:
        i = args.index("--sheets")
        sheets = Path(args[i + 1])
        sheets.mkdir(parents=True, exist_ok=True)
        del args[i:i + 2]
    names = args or ORDER
    (OUT / "stickers").mkdir(parents=True, exist_ok=True)
    (OUT / "preview").mkdir(parents=True, exist_ok=True)
    scenes = {n: Scene(n) for n in ORDER}

    for n in names:
        sc, dur = scenes[n], MOTION[n]["dur"]
        nv = round(dur * 30)
        frames = [sc.frame(i / nv) for i in range(nv)]
        crf, kb = encode_webm(frames, 30, OUT / "stickers" / f"{n}.webm")
        ng = round(dur * 20)
        g = [on_cream(sc.frame(i / ng), 256) for i in range(ng)]
        for colors in (128, 96, 64, 48):
            save_gif(g, 20, OUT / "preview" / f"{n}.gif", colors=colors)
            if (OUT / "preview" / f"{n}.gif").stat().st_size <= 900 * 1024:
                break
        gk = (OUT / "preview" / f"{n}.gif").stat().st_size / 1024
        print(f"{n}: {dur}s, 30fps, webm {kb:.0f} KB (crf {crf}), gif {gk:.0f} KB")
        if sheets:
            cells = [on_cream(frames[round(i * nv / 12)], 256) for i in range(12)]
            sheet = Image.new("RGB", (256 * 4, 256 * 3))
            for i, c in enumerate(cells):
                sheet.paste(c, ((i % 4) * 256, (i // 4) * 256))
            sheet.save(sheets / f"sheet_{n}.png")

    if names == ORDER:
        total, fps, tile = 10.0, 8, 128
        out = []
        for k in range(round(total * fps)):
            t = k / fps
            grid = Image.new("RGB", (tile * 3, tile * 2), CREAM)
            for i, n in enumerate(ORDER):
                im = on_cream(scenes[n].frame((t % MOTION[n]["dur"]) / MOTION[n]["dur"]), tile)
                grid.paste(im, ((i % 3) * tile, (i // 3) * tile))
            out.append(grid)
        save_gif(out, fps, OUT / "preview" / "all.gif", colors=32, dither=Image.NONE)
        print(f"all.gif {(OUT / 'preview' / 'all.gif').stat().st_size / 1024:.0f} KB")
        if sheets:
            out[0].save(sheets / "all_first.png")


if __name__ == "__main__":
    main()
