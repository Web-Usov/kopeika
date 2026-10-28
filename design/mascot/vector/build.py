#!/usr/bin/env python3
"""Копейка: векторный риг — монета без рук и ног, лицо слоями, эффекты эмоций и блеск.

    uv run python design/mascot/vector/build.py

Только стандартная библиотека. Читает base/coin_base.svg (оттрассированная монета) и base/rig2.json, пишет:
  web/public/brand/mascot/rig.svg            — все слои рига (эффекты выключены opacity=0, покой с фоновым блеском)
  web/public/brand/mascot/emotions/*.svg     — 18 статичных эмоций (только видимые слои, без анимации)
  web/public/brand/mascot/scenes/*.svg       — 10 анимированных сцен (SMIL, по кругу, работают в <img>)
  design/mascot/vector/preview/index.html    — демо с плавными переходами (из index.tpl.html), всё встроено
  design/mascot/vector/preview/data.json     — список эмоций и сцен для capture.cjs / sheets.py

Порядок слоёв внутри монеты (снизу вверх):
  монета #coin-clean → тонировки (покраснение снизу вверх / волна, вуаль) → блеск (перелив,
  проход, полоса, белые дуги, искры обода) → эффекты под лицом (сияние, ручейки слёз) → лицо →
  эффекты над лицом (румянец ///, щёчки-яблочки, надутые щёки, капля пота, венка, z z, звёздочки
  обода, искорки). Ребро монеты и 3D-поворот/наклон — в сценах zagruzka и kasanie.

Каждое состояние → словарь «элемент.атрибут → строка»; сцены — SMIL по ключам, демо — JS-интерполяция.
"""
import copy
import gzip
import json
import math
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = HERE / "base"
WEB = HERE.parents[2] / "web" / "public" / "brand" / "mascot"
PRE = HERE / "preview"
SRC = (BASE / "coin_base.svg").read_text()
RIG = json.loads((BASE / "rig2.json").read_text())
FM = RIG["face"]["m"]  # лицо (коорд. картинки 1254) → риг: s, tx, ty

# ───────────────────────── палитра ─────────────────────────
INK, DARK = "#180905", "#22100A"
TONGUE, TONGUE_D = "#EE575A", "#C8434B"
TEETH, WHITE = "#FFFBF4", "#FFFFFF"
C_OUT, C_OUT2 = "#6B2101", "#792A01"
C_DEEP, C_SHADOW, C_EDGE = "#B15709", "#CC6D0F", "#E28A17"
C_FIELD, C_MID, C_LIGHT, C_WHITE = "#F79A19", "#FBA51D", "#FDBC38", "#FEFDFC"
PINK, PINK_D = "#FF5C80", "#D6324E"
BLUE, POOL = "#A9E2FF", "#7CCBFF"
FXWHITE = "#FFFDF4"

VB = "190 120 620 620"
VB_SCENE = "160 50 680 680"
TK = ("translate", "rotate", "scale")


# ───────────────────────── числа ─────────────────────────
def n(v):
    s = str(int(round(v)))
    return "0" if s == "-0" else s


def n1(v):
    s = f"{v:.1f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def n3(v):
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


f = lambda v, k=1: (lambda s: "0" if s in ("-0", "") else s)(f"{v:.{k}f}".rstrip("0").rstrip("."))  # noqa: E731


def pt(p):
    return f"{n(p[0])} {n(p[1])}"


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


# ═════════════════════════ C: монета без бликов и блеск ═════════════════════════
CX, CY = 499.5, 429.7
R_SIL, R_OL, OL_W = 279.7, 272.0, 15.5
FX0, FY0 = 499.7, 423.6          # центр поля
GX, GY, GR = 498.4, 421.8, 213.5
IN_R = 264.0
BOTTOM = CY + R_SIL

_i0, _i1 = SRC.find('<g id="coin">'), SRC.find('<g id="face"')
COIN_PATHS = [p.replace(' fill-rule="evenodd"', "").replace(" />", "/>")
              for p in re.findall(r"<path[^>]*/>", SRC[_i0:_i1])]
assert len(COIN_PATHS) == 12


def pol(r, deg, cx=CX, cy=CY):
    t = math.radians(deg)
    return cx + r * math.cos(t), cy + r * math.sin(t)


def arc_d(r, a0, a1, cx=CX, cy=CY):
    x0, y0 = pol(r, a0, cx, cy)
    x1, y1 = pol(r, a1, cx, cy)
    return f"M{f(x0)} {f(y0)}A{f(r)} {f(r)} 0 {1 if abs(a1 - a0) > 180 else 0} 1 {f(x1)} {f(y1)}"


def circ_d(cx, cy, r):
    return f"M{f(cx - r)} {f(cy)}a{f(r)} {f(r)} 0 1 0 {f(2 * r)} 0a{f(r)} {f(r)} 0 1 0 {f(-2 * r)} 0Z"


HL_TL = dict(r=241.3, a0=-159.8, a1=-116.2, w=19.4)
HL_BR = dict(r=231.5, a0=35.6, a1=48.4, w=17.2)
STRIPE_U = (-112.5, -72.3)


def stripe_poly():
    s2 = math.sqrt(2)
    pts = [(FX0 + (u + v) / s2, FY0 + (u - v) / s2)
           for u, v in [(STRIPE_U[0], -260), (STRIPE_U[0], 260), (STRIPE_U[1], 260), (STRIPE_U[1], -260)]]
    return "M" + "L".join(f"{f(x)} {f(y)}" for x, y in pts) + "Z"


def CLEAN(p):
    """#coin-clean из C: трассировка без белых штрихов, светлый обод обрезан по ободу, следы закрыты заплатками."""
    return (f'<g id="{p}-coin">' + "".join(COIN_PATHS[:8])
            + f'<g clip-path="url(#{p}-rim)">' + "".join(COIN_PATHS[8:10]) + "</g>"
            + f'<path d="{arc_d(HL_TL["r"], -160.5, -115.5)}" fill="none" stroke="{C_LIGHT}" stroke-width="23" stroke-linecap="round"/>'
            + f'<path d="{arc_d(HL_BR["r"], 35.5, 48.5)}" fill="none" stroke="{C_SHADOW}" stroke-width="21" stroke-linecap="round"/>'
            + "</g>")


def rim_clip(p):
    return f'<clipPath id="{p}-rim"><path clip-rule="evenodd" d="{circ_d(CX, CY, 300)}{circ_d(FX0, FY0, 208)}"/></clipPath>'


EASE = {"lin": "0 0 1 1", "io": ".42 0 .58 1", "o": "0 0 .58 1", "i": ".42 0 1 1",
        "oo": ".2 .7 .4 1", "back": ".3 1.5 .6 1", "fall": ".5 0 .9 .6"}


def smil(tag, attr, keys, D, extra="", fmt=lambda v: v):
    """keys: [(t_ms, value, ease)] — ease описывает сегмент, который заканчивается этим ключом."""
    ks = sorted(keys, key=lambda k: k[0])
    if ks[0][0] > 0:
        ks.insert(0, (0, ks[0][1], "lin"))
    if ks[-1][0] < D:
        ks.append((D, ks[-1][1], "lin"))
    times = ";".join(f(k[0] / D, 4) for k in ks)
    vals = ";".join(fmt(k[1]) for k in ks)
    eases = [k[2] if len(k) > 2 else "lin" for k in ks[1:]]
    spl = f' calcMode="spline" keySplines="{";".join(EASE[e] for e in eases)}"' if any(e != "lin" for e in eases) else ""
    return (f'<{tag} attributeName="{attr}" dur="{D}ms" repeatCount="indefinite" keyTimes="{times}" '
            f'values="{vals}"{spl}{extra}/>')


def a_op(keys, D):
    return smil("animate", "opacity", keys, D, fmt=lambda v: f(v, 3))


def a_tr(kind, keys, D, fmt=None):
    if fmt is None:
        fmt = (lambda v: f"{f(v[0])} {f(v[1])}") if kind == "translate" else (lambda v: f(v, 3))
    return smil("animateTransform", "transform", keys, D, extra=f' type="{kind}"', fmt=fmt)


def a_sc(keys, D):
    return a_tr("scale", keys, D, fmt=lambda v: f"{f(v, 3)} {f(v, 3)}")


def sampled(attr, times, vals, D, tag="animate", extra="", calc="linear"):
    kt = ";".join(f(t / D, 5) for t in times)
    cm = "" if calc == "linear" else f' calcMode="{calc}"'
    return (f'<{tag} attributeName="{attr}" dur="{D}ms" repeatCount="indefinite"{cm} '
            f'keyTimes="{kt}" values="{";".join(vals)}"{extra}/>')


def gloss(p, stripe_anim="", tl_anim="", br_anim=""):
    """Статичный блеск C отдельным слоем: полоса в клипе поля + 2 белые дуги."""
    return (f'<g clip-path="url(#{p}-field)"><g>{stripe_anim}<path d="{stripe_poly()}" fill="{C_LIGHT}"/></g></g>'
            f'<g fill="none" stroke="{C_WHITE}" stroke-linecap="round">'
            f'<g>{tl_anim}<path d="{arc_d(HL_TL["r"], HL_TL["a0"], HL_TL["a1"])}" stroke-width="{HL_TL["w"]}"/></g>'
            f'<g>{br_anim}<path d="{arc_d(HL_BR["r"], HL_BR["a0"], HL_BR["a1"])}" stroke-width="{HL_BR["w"]}"/></g></g>')


SPOTS = {"tl_top": (HL_TL["r"], -118, 48), "br": (HL_BR["r"], 43, 38)}


def rim_spark(p, x, y, size, t0, D, life=560, rot=90):
    t1, t2 = t0 + life * 0.38, t0 + life
    sc = a_tr("scale", [(0, 0), (t0, 0), (t1, 1, "oo"), (t2, 0, "i")], D)
    ro = a_tr("rotate", [(0, 0), (t0, 0), (t2, rot, "o")], D, fmt=lambda v: f(v, 1))
    body = (f'<use href="#{p}-star" fill="{C_WHITE}" stroke="{C_EDGE}" stroke-width="{f(3.2 / size, 3)}" stroke-linejoin="round"/>'
            f'<use href="#{p}-star" fill="{C_WHITE}" transform="rotate(45) scale(.45)"/>')
    return f'<g transform="translate({f(x)} {f(y)}) scale({size})"><g transform="scale(0)">{sc}<g>{ro}{body}</g></g></g>'


def spot(p, name, t0, D, size=None, **kw):
    r, a, s = SPOTS[name]
    x, y = pol(r, a)
    return rim_spark(p, x, y, size or s, t0, D, **kw)


def sweep_band(p, t0, t1, D, alpha=1.0):
    """Широкий мягкий проход (C, 1б) по полю и ободу, клип без канавки и контура."""
    off = 285
    tr = a_tr("translate", [(0, (-off, -off)), (t0, (-off, -off)), (t1, (off, off), "io")], D)
    return (f'<g clip-path="url(#{p}-in)"><g transform="translate({-off} {-off})">{tr}<g transform="translate({CX} {CY}) rotate(-45)">'
            f'<rect x="-420" y="-95" width="840" height="190" fill="url(#{p}-soft)" opacity="{f(alpha, 2)}"/></g></g></g>')


def soft_grad(p):
    return (f'<linearGradient id="{p}-soft" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="0" stop-color="{C_LIGHT}" stop-opacity="0"/><stop offset=".3" stop-color="{C_LIGHT}" stop-opacity=".75"/>'
            f'<stop offset=".5" stop-color="{C_WHITE}" stop-opacity=".7"/><stop offset=".7" stop-color="{C_LIGHT}" stop-opacity=".75"/>'
            f'<stop offset="1" stop-color="{C_LIGHT}" stop-opacity="0"/></linearGradient>')


def iris_grad(p, D, alpha=1.0):
    a = lambda v: f(v * alpha, 3)  # noqa: E731
    return (f'<linearGradient id="{p}-iris" gradientUnits="userSpaceOnUse" x1="{f(CX - 150)}" y1="{f(CY - 150)}" '
            f'x2="{f(CX + 150)}" y2="{f(CY + 150)}" spreadMethod="reflect">'
            f'<animateTransform attributeName="gradientTransform" type="translate" dur="{D}ms" repeatCount="indefinite" values="-600 -600;0 0"/>'
            f'<stop offset="0" stop-color="{C_SHADOW}" stop-opacity="{a(.34)}"/><stop offset=".42" stop-color="{C_FIELD}" stop-opacity="0"/>'
            f'<stop offset=".78" stop-color="{C_LIGHT}" stop-opacity="{a(.5)}"/><stop offset="1" stop-color="{C_WHITE}" stop-opacity="{a(.42)}"/>'
            "</linearGradient>")


REST_D = 6400


SWEEP_A = .6


def shine_markup(p, mode, sweep=None):
    """mode: 'static' — полоса + дуги; 'rest' — «всё вместе» из C (перелив, проход раз в 6,4 с, 2 искры).
    sweep=(t0, t1, D, under_tint): один широкий мягкий проход за круг сцены (над тонировкой, если не under_tint)."""
    if mode == "rest":
        D = REST_D
        under = (f'<rect clip-path="url(#{p}-in)" x="200" y="130" width="600" height="600" fill="url(#{p}-iris)"/>'
                 + sweep_band(p, 1200, 2200, D, alpha=.55))
        over = spot(p, "tl_top", 3700, D, size=34) + spot(p, "br", 4500, D, size=26)
        return under + gloss(p) + over
    band = sweep_band(p, sweep[0], sweep[1], sweep[2], alpha=SWEEP_A) if sweep and not sweep[3] else ""
    return band + gloss(p)


# ═════════════════════════ A: лицо ═════════════════════════
LIQ = "#53301F"
EYE_C = {"L": (420, 551), "R": (822, 551)}
RX, RY = 105, 114
N = 17
NT = 9
LID_W, LOW_W, ARC_W, MOUTH_W, CORNER_W = 22, 10, 26, 14, 10


def cub(P, t):
    a, b, c, d = P
    m = 1 - t
    return (m**3 * a[0] + 3 * m * m * t * b[0] + 3 * m * t * t * c[0] + t**3 * d[0],
            m**3 * a[1] + 3 * m * m * t * b[1] + 3 * m * t * t * c[1] + t**3 * d[1])


def split(P, t):
    a, b, c, d = P
    ab, bc, cd = lerp(a, b, t), lerp(b, c, t), lerp(c, d, t)
    abc, bcd = lerp(ab, bc, t), lerp(bc, cd, t)
    m = lerp(abc, bcd, t)
    return [a, ab, abc, m], [m, bcd, cd, d]


def sub(P, t0, t1):
    left, _ = split(P, t1)
    return split(left, t0 / t1)[1] if t1 > 0 else [P[0]] * 4


def qb(p0, p1, p2):
    return lambda t: ((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
                      (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1])


def cb(p0, p1, p2, p3):
    return lambda t: cub([p0, p1, p2, p3], t)


def catmull(pts):
    out = []
    m = len(pts)
    for i in range(m - 1):
        p0 = pts[i - 1] if i > 0 else pts[i]
        p1, p2 = pts[i], pts[i + 1]
        p3 = pts[i + 2] if i + 2 < m else pts[i + 1]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        out.append(f"C{pt(c1)} {pt(c2)} {pt(p2)}")
    return "".join(out)


def shape(top, bot):
    return f"M{pt(top[0])}" + catmull(top) + catmull(bot[::-1]) + "Z"


def cpath(P):
    return f"M{pt(P[0])}C{pt(P[1])} {pt(P[2])} {pt(P[3])}"


def cos_xs(x0, x1, k):
    c, h = (x0 + x1) / 2, (x1 - x0) / 2
    return [c - h * math.cos(math.pi * i / (k - 1)) for i in range(k)]


LID = {
    "open": (-180, -180, 0), "think": (-66, -72, 6), "drowsy": (-42, -42, 6), "sleepy": (-6, -6, 8),
    "heavy": (24, 24, 2), "sad": (-34, -112, 10), "sadS": (-62, -110, 6), "angry": (-122, -26, 0),
    "angryS": (-112, -56, 0), "sly": (-44, -56, 30), "closed": (36, 36, -30),
}
LOW = {"open": (180, 180, 0), "sly": (46, 40, 40), "smile": (70, 70, 34), "closed": (36, 36, -30)}


def lid_pts(p, side):
    yo, yi, b = p
    k = 4 / 3 * b
    P = [(-150, yo), (-50, yo + (yi - yo) / 3 - k), (50, yo + 2 * (yi - yo) / 3 - k), (150, yi)]
    if side == "R":
        P = [(-x, y) for x, y in P][::-1]
    return P


def lid_line(P, pad=-8):
    ins = [i / 800 for i in range(801)
           if (cub(P, i / 800)[0] / (RX + pad)) ** 2 + (cub(P, i / 800)[1] / (RY + pad)) ** 2 < 1]
    if not ins:
        return None
    return sub(P, ins[0], ins[-1])


def aperture(U, D):
    return (f"M{pt(U[0])}C{pt(U[1])} {pt(U[2])} {pt(U[3])}"
            f"L{pt(D[3])}C{pt(D[2])} {pt(D[1])} {pt(D[0])}Z")


def mirror(pts, side):
    return pts if side == "L" else [(-x, y) for x, y in pts]


def straight(a, b):
    return [lerp(a, b, 1 / 3), lerp(a, b, 2 / 3), b]


ARCS = {
    "happy": lambda: [(-74, 26), (-70, -12), (-40, -42), (0, -42), (40, -42), (70, -12), (74, 26)],
    "laugh": lambda: [(-46, -48)] + straight((-46, -48), (44, 0)) + straight((44, 0), (-46, 48)),
    "closed": lambda: (lambda a_b: a_b[0] + a_b[1][1:])(split(lid_line(lid_pts(LID["closed"], "L")), 0.5)),
}


def arc_dd(pts):
    return f"M{pt(pts[0])}C{pt(pts[1])} {pt(pts[2])} {pt(pts[3])}C{pt(pts[4])} {pt(pts[5])} {pt(pts[6])}"


def star_d(r1, r2, k=5):
    pts = [((r1 if i % 2 == 0 else r2) * math.cos(math.radians(-90 + i * 180 / k)),
            (r1 if i % 2 == 0 else r2) * math.sin(math.radians(-90 + i * 180 / k))) for i in range(2 * k)]
    return "M" + "L".join(pt(p) for p in pts) + "Z"


def sparkle_d(r, k=0.2):
    c = r * k
    return (f"M0 {n(-r)}Q{n(c)} {n(-c)} {n(r)} 0Q{n(c)} {n(c)} 0 {n(r)}"
            f"Q{n(-c)} {n(c)} {n(-r)} 0Q{n(-c)} {n(-c)} 0 {n(-r)}Z")


def heart_b(cx, cy, s):
    """Сердечко из B (кубики по 19 точкам)."""
    pts = [(0, .95), (-.12, .82), (-1, .3), (-1, -.22), (-1, -.68), (-.58, -.98), (-.27, -.9), (-.1, -.85), (0, -.68), (0, -.56),
           (0, -.68), (.1, -.85), (.27, -.9), (.58, -.98), (1, -.68), (1, -.22), (1, .3), (.12, .82), (0, .95)]
    P = [f"{n1(cx + x * s)} {n1(cy + y * s)}" for x, y in pts]
    out = f"M{P[0]}"
    for i in range(1, len(P), 3):
        out += f"C{P[i]} {P[i + 1]} {P[i + 2]}"
    return out + "Z"


def E(kind="ball", lid="open", low="open", look=(0, 0), s=1.0, hl="std", hs=1.0, hloff=(0, 0),
      arc="closed", star=(0, 1.0)):
    return dict(kind=kind, lid=lid, low=low, look=look, s=s, hl=hl, hs=hs, hloff=hloff, arc=arc, star=star)


HL_SETS = ("std", "star", "wet", "tiny", "heart")


def eye_ch(e, side):
    c = {}
    c[f"look{side}.translate"] = f"{n(e['look'][0])} {n(e['look'][1])}"
    c[f"scl{side}.scale"] = f"{n3(e['s'])} {n3(e['s'])}"
    c[f"ball{side}.opacity"] = "1" if e["kind"] == "ball" else "0"
    lp = LID[e["lid"]] if isinstance(e["lid"], str) else e["lid"]
    dp = LOW[e["low"]] if isinstance(e["low"], str) else e["low"]
    U, D = lid_pts(lp, side), lid_pts(dp, side)
    c[f"ap{side}.d"] = aperture(U, D)
    lu, ld = lid_line(U), lid_line(D, pad=-6)
    c[f"lid{side}.d"] = cpath(lu or [(0, -RY - 8)] * 4)
    c[f"lid{side}.opacity"] = "1" if lu else "0"
    c[f"low{side}.d"] = cpath(ld or [(0, RY + 6)] * 4)
    c[f"low{side}.opacity"] = "1" if ld and e["low"] not in ("open", "closed") else "0"
    hx = e["hloff"][0] - 0.35 * e["look"][0]
    hy = e["hloff"][1] - 0.35 * e["look"][1]
    c[f"hls{side}.translate"] = f"{n(hx)} {n(hy)}"
    for k in HL_SETS:
        c[f"hl{k}{side}.opacity"] = "1" if e["hl"] == k else "0"
    c[f"hlstd{side}.scale"] = f"{n3(e['hs'])} {n3(e['hs'])}"
    c[f"hlstar{side}.scale"] = f"{n3(e['star'][1])} {n3(e['star'][1])}"
    c[f"star{side}.rotate"] = n(e["star"][0])
    c[f"arc{side}.d"] = arc_dd(mirror(ARCS[e["arc"]](), side))
    c[f"arc{side}.opacity"] = "1" if e["kind"] == "arc" else "0"
    return c


def m_open(x0, x1, ytop, topcurve, depth, p=2.2, q=0.9):
    c, h = (x0 + x1) / 2, (x1 - x0) / 2
    top, bot = [], []
    for x in cos_xs(x0, x1, N):
        u = (x - c) / h
        top.append((x, ytop + topcurve * (1 - u * u)))
        bot.append((x, ytop + depth * max(0.0, 1 - abs(u) ** p) ** q))
    return top, bot


def m_line(fn, w=13, taper=0.5):
    top, bot = [], []
    for i in range(N):
        t = i / (N - 1)
        x, y = fn(t)
        x1, y1 = fn(max(0, t - 1e-3))
        x2, y2 = fn(min(1, t + 1e-3))
        L = math.hypot(x2 - x1, y2 - y1) or 1
        nx, ny = -(y2 - y1) / L, (x2 - x1) / L
        hw = w / 2 * math.sin(math.pi * t) ** taper
        top.append((x - nx * hw, y - ny * hw))
        bot.append((x + nx * hw, y + ny * hw))
    return top, bot


def m_ellipse(cx, cy, rx, ry_t, ry_b, e=2.0):
    top, bot = [], []
    for i in range(N):
        th = math.pi * (1 - i / (N - 1))
        co, si = math.cos(th), math.sin(th)
        x = cx + rx * math.copysign(abs(co) ** (2 / e), co)
        s = abs(si) ** (2 / e)
        top.append((x, cy - ry_t * s))
        bot.append((x, cy + ry_b * s))
    return top, bot


def tongue(x0, x1, ytop, hump, depth, q=0.6, flat=0.0):
    c, h = (x0 + x1) / 2, (x1 - x0) / 2
    top, bot = [], []
    for x in cos_xs(x0, x1, NT):
        u = (x - c) / h
        yt = ytop - hump * (1 - u * u) + flat * u ** 6
        top.append((x, yt))
        bot.append((x, yt + depth * max(0.0, 1 - u * u) ** q))
    return top, bot


T_HIDDEN = ([(619, 792)] * NT, [(619, 792)] * NT)

MOUTHS = {
    "smile": lambda: dict(m=m_open(510, 728, 694, 0, 98, 2.2, 0.9), tg=tongue(556, 682, 717, 0, 58, 0.6, 10)),
    "smileS": lambda: dict(m=m_open(536, 702, 700, 0, 76, 2.2, 0.9), tg=tongue(570, 668, 718, 0, 44, 0.6, 8)),
    "grin": lambda: dict(m=m_open(488, 750, 684, 14, 142, 2.0, 0.85), tg=tongue(540, 698, 792, 20, 70, 0.5), tt=718),
    "smileLine": lambda: dict(m=m_line(qb((554, 736), (619, 798), (684, 736)), 14, 0.5), cn="both"),
    "cat": lambda: dict(m=m_line(lambda t: (546 + 146 * t, 744 + 17 * math.sin(math.pi * abs(2 * t - 1))
                                            - 8 * abs(2 * t - 1) ** 3), 11, 0.3)),
    "smirk": lambda: dict(m=m_line(cb((564, 750), (612, 770), (664, 764), (692, 724)), 14, 0.5), cn="R"),
    "o": lambda: dict(m=m_ellipse(619, 756, 40, 52, 52), tg=tongue(590, 648, 786, 6, 34, 0.5)),
    "oSmall": lambda: dict(m=m_ellipse(619, 758, 21, 25, 25)),
    "hmm": lambda: dict(m=m_line(cb((566, 754), (622, 753), (664, 752), (688, 737)), 11, 0.35)),
    "wavy": lambda: dict(m=m_line(lambda t: (540 + 158 * t, 750 + 10 * math.sin(4 * math.pi * t)), 11, 0.3)),
    "sad": lambda: dict(m=m_line(qb((560, 778), (619, 722), (678, 778)), 14, 0.5)),
    "sadW": lambda: dict(m=m_line(lambda t: (560 + 118 * t, 778 - 56 * math.sin(math.pi * t) ** 1.2
                                             + 6 * math.sin(4 * math.pi * t)), 14, 0.5)),
    "pout": lambda: dict(m=m_line(cb((586, 770), (596, 740), (642, 740), (652, 770)), 17, 0.45)),
    "angry": lambda: dict(m=(lambda xs_: ([(x, 776 - 52 * (1 - ((x - 619) / 82) ** 2) ** 0.8) for x in xs_],
                                          [(x, 776 + 8 * (1 - ((x - 619) / 82) ** 2)) for x in xs_]))(
        cos_xs(537, 701, N)), tt=755, tb=761),
    "oi": lambda: dict(m=m_ellipse(619, 754, 68, 44, 50, 2.6), tt=740, gap=True, tg=tongue(582, 656, 784, 8, 36, 0.5)),
    "tongue": lambda: dict(m=m_line(qb((562, 742), (619, 772), (676, 742)), 12, 0.4), tout=True),
}

TOUT_PIV = (630, 752)
TOUT = (f'<path d="M603 748C600 794 608 822 630 822C652 822 660 794 657 748Z" fill="{TONGUE}" stroke="{INK}" '
        f'stroke-width="11" stroke-linejoin="round"/>'
        f'<path d="M630 766V798" stroke="{TONGUE_D}" stroke-width="7" stroke-linecap="round"/>')


def ticks(top, bot, which):
    out = []
    for end in ("L", "R"):
        if end == "L":
            E0, nb = top[0], lerp(top[2], bot[2], 0.5)
        else:
            E0, nb = top[-1], lerp(top[-3], bot[-3], 0.5)
        dx, dy = E0[0] - nb[0], E0[1] - nb[1]
        L = math.hypot(dx, dy) or 1
        d = (dx / L, dy / L)
        p = (-d[1], d[0])
        if which in ("both", end):
            C = (E0[0] + d[0] * 5, E0[1] + d[1] * 5)
            a, b = (C[0] + p[0] * 13, C[1] + p[1] * 13), (C[0] - p[0] * 13, C[1] - p[1] * 13)
            k = (C[0] + d[0] * 9, C[1] + d[1] * 9)
            out.append(f"M{pt(a)}Q{pt(k)} {pt(b)}")
        else:
            out.append(f"M{pt(E0)}Q{pt(E0)} {pt(E0)}")
    return "".join(out)


LINE_MOUTHS = {"smileLine", "cat", "smirk", "hmm", "wavy", "sad", "sadW", "pout", "tongue"}


def mouth_ch(name, cn=None, tout_k=1.0):
    M = MOUTHS[name]()
    c = {}
    top, bot = M["m"]
    c["m.d"] = shape(top, bot)
    c["mc.d"] = c["m.d"]
    tg = M.get("tg")
    c["tg.d"] = shape(*(tg or T_HIDDEN))
    c["tg.opacity"] = "1" if tg else "0"
    c["tt.d"] = f"M440 640H800V{n(M.get('tt', 640))}H440Z"
    c["tt.opacity"] = "1" if "tt" in M else "0"
    c["tb.d"] = f"M440 {n(M.get('tb', 860))}H800V860H440Z"
    c["tb.opacity"] = "1" if "tb" in M else "0"
    c["gap.opacity"] = "1" if M.get("gap") else "0"
    c["tout.opacity"] = "1" if M.get("tout") else "0"
    c["tout.scale"] = f"1 {n3(tout_k if M.get('tout') else 0.2)}"
    which = M.get("cn", "") if cn is None else ("both" if cn is True else (cn or ""))
    if name not in LINE_MOUTHS:   # решение: уголки только у ртов-линий
        which = ""
    c["cn.d"] = ticks(top, bot, which or "none")
    c["cn.opacity"] = "1" if which else "0"
    return c


# ═════════════════════════ B: эффекты (в координатах рига) ═════════════════════════
S_F = FM[0]


def f2r(x, y):
    return S_F * x + FM[1], S_F * y + FM[2]


EYE_RIG = {k: f2r(*v) for k, v in EYE_C.items()}   # центры глаз A в риге ≈ (390, 394), (608, 394)
MID_X = (EYE_RIG["L"][0] + EYE_RIG["R"][0]) / 2
CHEEK_Y = 482
CHEEK = {"L": (EYE_RIG["L"][0] - 38, CHEEK_Y), "R": (EYE_RIG["R"][0] + 38, CHEEK_Y)}
R_GOLD = 268.0


def stroke(d, color, w, extra=""):
    return (f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{n1(w)}" stroke-linecap="round" '
            f'stroke-linejoin="round"{" " + extra if extra else ""}/>')


def star4(cx, cy, r, k=0.16):
    a = r * k
    return (f"M{n1(cx)} {n1(cy - r)}Q{n1(cx + a)} {n1(cy - a)} {n1(cx + r)} {n1(cy)}Q{n1(cx + a)} {n1(cy + a)} {n1(cx)} {n1(cy + r)}"
            f"Q{n1(cx - a)} {n1(cy + a)} {n1(cx - r)} {n1(cy)}Q{n1(cx - a)} {n1(cy - a)} {n1(cx)} {n1(cy - r)}Z")


def drop(cx, cy, r):
    return (f"M{n1(cx)} {n1(cy - 1.75 * r)}C{n1(cx + .35 * r)} {n1(cy - 1.2 * r)} {n1(cx + r)} {n1(cy - .62 * r)} {n1(cx + r)} {n1(cy)}"
            f"A{n1(r)} {n1(r)} 0 0 1 {n1(cx - r)} {n1(cy)}C{n1(cx - r)} {n1(cy - .62 * r)} {n1(cx - .35 * r)} {n1(cy - 1.2 * r)} {n1(cx)} {n1(cy - 1.75 * r)}Z")


def drop_el(cx, cy, r, sw=5.5, fill=BLUE):
    return (f'<path d="{drop(cx, cy, r)}" fill="{fill}" stroke="{INK}" stroke-width="{n1(sw)}" stroke-linejoin="round"/>'
            f'<ellipse cx="{n1(cx - r * .38)}" cy="{n1(cy - r * .05)}" rx="{n1(r * .22)}" ry="{n1(r * .36)}" fill="#fff" opacity=".95"/>')


def hatch3(cx, cy, color, w=6.5, h=26, gap=19):
    return "".join(stroke(f"M{n1(cx + i * gap - h * .3)} {n1(cy + h / 2)}L{n1(cx + i * gap + h * .3)} {n1(cy - h / 2)}", color, w)
                   for i in (-1, 0, 1))


def vein_d(cx, cy, L, g):
    d = ""
    for sx, sy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        d += f"M{n1(cx + sx * g)} {n1(cy + sy * L)}Q{n1(cx + sx * g * 1.1)} {n1(cy + sy * g * 1.1)} {n1(cx + sx * L)} {n1(cy + sy * g)}"
    return d


def zpath(x, y, s):
    return f"M{n1(x)} {n1(y)}H{n1(x + s)}L{n1(x)} {n1(y + s)}H{n1(x + s)}"


def bpolar(r, deg):
    a = math.radians(deg)
    return 500 + r * math.cos(a), 430 + r * math.sin(a)


def cub3(p, t):
    return tuple((1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d for a, b, c, d in zip(*p))


def cub3_d(p, t):
    return tuple(3 * (1 - t) ** 2 * (b - a) + 6 * (1 - t) * t * (c - b) + 3 * t * t * (d - c) for a, b, c, d in zip(*p))


# ручейок (B, «тонкие»), осевая сдвинута под глаз A
_dx, _dy = EYE_RIG["L"][0] - 388.4, EYE_RIG["L"][1] - 390.9
STREAM_L = tuple((x + _dx, y + _dy) for x, y in ((376, 450), (360, 494), (416, 512), (402, 566)))


def streams(animate, w0=14, w1=8, rb=8, fill=BLUE, sw=4, hi=3.2):
    """Тонкие ручейки (B): сужающаяся лента по S-кривой с контуром + капля-навершие.
    animate: блик бежит stroke-dashoffset (.7 с), капля сбегает animateMotion (1.4 с)."""
    out = ""
    for k in "LR":
        P = STREAM_L if k == "L" else tuple((2 * MID_X - x, y) for x, y in STREAM_L)
        NN = 24
        left, right, hil = [], [], []
        for i in range(NN + 1):
            t = i / NN
            (x, y), (dx, dy) = cub3(P, t), cub3_d(P, t)
            ln = math.hypot(dx, dy)
            nx, ny = -dy / ln, dx / ln
            w = (w0 + (w1 - w0) * t) / 2
            left.append((x + nx * w, y + ny * w))
            right.append((x - nx * w, y - ny * w))
            side = 1 if k == "L" else -1
            hil.append((x + side * nx * w * .42, y + side * ny * w * .42))
        poly = "M" + "L".join(f"{n1(x)} {n1(y)}" for x, y in left + right[::-1]) + "Z"
        ex, ey = P[3]
        cy_b = ey + rb * .35
        axis = f"M{n1(P[0][0])} {n1(P[0][1])}C{n1(P[1][0])} {n1(P[1][1])} {n1(P[2][0])} {n1(P[2][1])} {n1(ex)} {n1(ey)}"
        out += (f'<path d="{poly}" fill="{INK}" stroke="{INK}" stroke-width="{n1(2 * sw)}" stroke-linejoin="round"/>'
                f'<circle cx="{n1(ex)}" cy="{n1(cy_b)}" r="{n1(rb + sw)}" fill="{INK}"/>'
                f'<path d="{poly}" fill="{fill}"/><circle cx="{n1(ex)}" cy="{n1(cy_b)}" r="{n1(rb)}" fill="{fill}"/>')
        hd = "M" + "L".join(f"{n1(x)} {n1(y)}" for x, y in hil[2:-3])
        an = ('<animate attributeName="stroke-dashoffset" from="0" to="-34" dur=".7s" repeatCount="indefinite"/>'
              if animate else "")
        out += (f'<path d="{hd}" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="{n1(hi)}" stroke-linecap="round" '
                f'stroke-dasharray="12 22">{an}</path>')
        bx = ex + (-1 if k == "L" else 1) * rb * .38
        out += f'<ellipse cx="{n1(bx)}" cy="{n1(cy_b - rb * .1)}" rx="{n1(rb * .24)}" ry="{n1(rb * .36)}" fill="#fff" opacity=".95"/>'
        if animate:
            out += (f'<g opacity="0">{drop_el(0, 0, w0 * .32 + 1.5, sw=sw * .7)}'
                    f'<animateMotion dur="1.4s" repeatCount="indefinite" path="{axis}" calcMode="spline" '
                    f'keyPoints="0;1" keyTimes="0;1" keySplines=".5 0 .9 .6"/>'
                    f'<animate attributeName="opacity" dur="1.4s" repeatCount="indefinite" values="0;1;1;0" keyTimes="0;.12;.78;1"/></g>')
    return out


WAVE_D = "M" + " L".join(f"{x} {n1(-12 * math.sin(x / 55))}" for x in range(100, 1001, 20)) + " L1000 600 L100 600Z"

SPARKS = [(618, 262, 30), (318, 300, 22), (694, 528, 34), (370, 600, 19), (566, 612, 14), (446, 248, 13)]
RIMS = [(-118, 28), (-62, 16), (32, 24), (158, 15), (82, 12), (-170, 11)]
SWEAT = (648, 312, 15)
VEIN = (590, 284)
ZZ = [(532, 296, 24), (560, 270, 17), (582, 250, 11)]   # внутри поля, не заходят на канавку


# Надутые щёки: симметрично относительно оси лица, привязаны к монете (не к сдвигу лица),
# меньше и ниже, чем в B. Зазор до канавки (поле r=204) считается в puff_gap() и печатается при сборке.
PUFF_X, PUFF_Y, PUFF_R, PUFF_SW = 392, 518, 34, 7


def puff(x, y, k):
    sg = -1 if k == "L" else 1
    x = PUFF_X if k == "L" else 2 * MID_X - PUFF_X
    y, r = PUFF_Y, PUFF_R
    q = r / 44
    a0, a1 = math.radians(-58), math.radians(62)
    p0 = (x + sg * r * math.cos(a0), y + r * math.sin(a0))
    p1 = (x + sg * r * math.cos(a1), y + r * math.sin(a1))
    hx, hy = x - sg * 14 * q, y - 18 * q
    return (f'<circle cx="{n1(x)}" cy="{n1(y)}" r="{r}" fill="url(#P-gPuff)"/>'
            + stroke(f"M{n1(p0[0])} {n1(p0[1])}A{r} {r} 0 0 {1 if k == 'R' else 0} {n1(p1[0])} {n1(p1[1])}", INK, PUFF_SW)
            + f'<ellipse cx="{n1(hx)}" cy="{n1(hy)}" rx="{n1(9 * q)}" ry="{n1(6 * q)}" fill="#fff" opacity=".9" '
              f'transform="rotate({sg * 20} {n1(hx)} {n1(hy)})"/>')


def puff_gap():
    """Зазор от внешнего края щеки (с обводкой) до поля внутри канавки, в единицах рига, для L и R.
    Щёки лежат в той же группе наклона/сжатия, что и монета, поэтому наклон зазор не меняет."""
    out = []
    for x in (PUFF_X, 2 * MID_X - PUFF_X):
        out.append(round(204 - (math.hypot(x - FX0, PUFF_Y - FY0) + PUFF_R + PUFF_SW / 2), 1))
    return out


def blush_hatch(x, y, k):
    return f'<ellipse cx="{n1(x)}" cy="{y}" rx="44" ry="24" fill="{PINK}" opacity=".3"/>' + hatch3(x, y, PINK_D)


def apple(x, y, k):
    ex = x - 12 if k == "L" else x + 12
    y -= 12   # над штриховым румянцем, чтобы дуга не перечёркивала штрихи
    return (stroke(f"M{n1(x - 34)} {y + 4}Q{n1(x)} {y - 26} {n1(x + 34)} {y + 4}", "#FFE7A0", 6, 'opacity=".9"')
            + f'<ellipse cx="{n1(ex)}" cy="{y - 4}" rx="11" ry="6.5" fill="#fff" opacity=".85" '
              f'transform="rotate({-20 if k == "L" else 20} {n1(ex)} {y - 4})"/>')


def cheeks(fn):
    return "".join(fn(*CHEEK[k], k) for k in "LR")


def fx_defs(p):
    """Градиенты и клипы эффектов (в документ попадают только те, на которые есть ссылки)."""
    return [
        ("cCoin", f'<clipPath id="{p}-cCoin"><circle cx="500" cy="430" r="{n(R_GOLD)}"/></clipPath>'),
        ("gPuff", f'<radialGradient id="{p}-gPuff" cx=".42" cy=".38"><stop offset="0" stop-color="#FF9AAE"/>'
                  f'<stop offset=".6" stop-color="{PINK}" stop-opacity=".7"/><stop offset="1" stop-color="{PINK}" stop-opacity="0"/></radialGradient>'),
        ("gGlow", f'<radialGradient id="{p}-gGlow" gradientUnits="userSpaceOnUse" cx="500" cy="440" r="250">'
                  f'<stop offset="0" stop-color="#FFF7D2" stop-opacity=".75"/><stop offset=".45" stop-color="#FFF0B0" stop-opacity=".4"/>'
                  f'<stop offset="1" stop-color="#FFE38A" stop-opacity="0"/></radialGradient>'),
        ("gSpark", f'<radialGradient id="{p}-gSpark"><stop offset="0" stop-color="#FFFBE6" stop-opacity=".9"/>'
                   f'<stop offset="1" stop-color="#FFF3C0" stop-opacity="0"/></radialGradient>'),
        ("gRed", f'<linearGradient id="{p}-gRed" gradientUnits="userSpaceOnUse" x1="0" y1="700" x2="0" y2="160">'
                 f'<stop offset="0" stop-color="#E3261F" stop-opacity=".62"/><stop offset=".5" stop-color="#E8352A" stop-opacity=".42"/>'
                 f'<stop offset="1" stop-color="#EE4A33" stop-opacity=".12"/></linearGradient>'),
        ("gWave", f'<linearGradient id="{p}-gWave" x1="0" y1="0" x2="0" y2="1">'
                  f'<stop offset="0" stop-color="#EE4A33" stop-opacity=".2"/><stop offset=".3" stop-color="#E8352A" stop-opacity=".42"/>'
                  f'<stop offset="1" stop-color="#E3261F" stop-opacity=".62"/></linearGradient>'),
        ("field", f'<clipPath id="{p}-field"><circle cx="{FX0}" cy="{FY0}" r="204"/></clipPath>'),
        ("in", f'<clipPath id="{p}-in"><path clip-rule="evenodd" d="{circ_d(CX, CY - 0.3, IN_R)}{circ_d(GX, GY, GR)}{circ_d(FX0, FY0, 204)}"/></clipPath>'),
        ("star", f'<path id="{p}-star" d="M0-1Q.15-.15 1 0Q.15.15 0 1Q-.15.15-1 0Q-.15-.15 0-1Z"/>'),
        ("rim", rim_clip(p)),
        ("soft", soft_grad(p)),
        ("iris", iris_grad(p, REST_D, alpha=.55)),
    ]


FX_NAMES = ["red", "wave", "pale", "glow", "tears", "blush", "apples", "puff", "sweat", "vein", "zz", "rim", "spark"]
FX_LABEL = {"red": "покраснение снизу вверх", "wave": "покраснение волной (анимация)", "pale": "вуаль побледнения",
            "glow": "мягкое сияние", "tears": "ручейки слёз", "blush": "румянец ///", "apples": "щёчки-яблочки",
            "puff": "надутые румяные щёки", "sweat": "капля пота", "vein": "венка", "zz": "z z", "rim": "звёздочки обода",
            "spark": "искорки"}


# ───────────────────────── слои глаза ─────────────────────────
HL_STD = (f'<circle cx="-40" cy="-36" r="32" fill="{WHITE}"/>'
          f'<path d="M-35 -77Q-3 -98 28 -80" fill="none" stroke="{WHITE}" stroke-width="21" stroke-linecap="round"/>'
          f'<ellipse cx="57" cy="-54" rx="18" ry="12" transform="rotate(50 57 -54)" fill="{WHITE}"/>'
          f'<circle cx="25" cy="46" r="15" fill="{WHITE}"/>')
# «Мокрые глаза»: лужица снизу и белая волна по ней (B) + крупные блики A
HL_WET = (f'<ellipse cy="{n(RY * .98)}" rx="{n(RX * 1.15)}" ry="{n(RY * .5)}" fill="{POOL}" opacity=".8"/>'
          + stroke(f"M{n(-RX * .8)} {n(RY * .56)}q{n(RX * .2)} -12 {n(RX * .4)} 0t{n(RX * .4)} 0t{n(RX * .4)} 0t{n(RX * .4)} 0", "#fff", 9, 'opacity=".9"')
          + f'<circle cx="-38" cy="-34" r="38" fill="{WHITE}"/>'
          f'<path d="M-35 -79Q-3 -100 28 -82" fill="none" stroke="{WHITE}" stroke-width="21" stroke-linecap="round"/>'
          f'<ellipse cx="57" cy="-52" rx="18" ry="12" transform="rotate(50 57 -52)" fill="{WHITE}"/>'
          f'<circle cx="40" cy="14" r="15" fill="{WHITE}"/><circle cx="-6" cy="20" r="6" fill="{WHITE}"/>')
# «Испугалась»: маленький тёмный глаз — крупный блик и точка (без светлой радужки)
HL_TINY = f'<circle cx="-28" cy="-32" r="34" fill="{WHITE}"/><circle cx="34" cy="38" r="15" fill="{WHITE}"/>'
# «Влюблена»: сердечко вместо большого блика (B, «сердечки в бликах глаз»)
HL_HEART = (f'<path d="{heart_b(-24, -26, 46)}" fill="{WHITE}"/>'
            f'<ellipse cx="58" cy="-54" rx="16" ry="11" transform="rotate(50 58 -54)" fill="{WHITE}"/>'
            f'<circle cx="34" cy="46" r="14" fill="{WHITE}"/>')


# ═════════════════════════ состояние ═════════════════════════
def S(L=None, R=None, mouth="smile", cn=None, dy=0, a=0, sx=1, sy=1, fx=0, fy=0, tout=1.0, ef=None):
    L = L or E()
    return dict(L=L, R=R or copy.deepcopy(L), mouth=mouth, cn=cn, dy=dy, a=a, sx=sx, sy=sy, fx=fx, fy=fy,
                tout=tout, ef=dict(ef or {}))


def mod(st, eyes=None, L=None, R=None, **kw):
    s = copy.deepcopy(st)
    for side, upd in (("L", eyes), ("R", eyes), ("L", L), ("R", R)):
        if upd:
            s[side].update(upd)
    if "ef" in kw:
        s["ef"] = {**s["ef"], **kw.pop("ef")}
    s.update(kw)
    return s


def channels(st):
    c = {"jump.translate": f"0 {n(st['dy'])}", "tilt.rotate": f"{n(st['a'])} 500 430",
         "sq.scale": f"{n3(st['sx'])} {n3(st['sy'])}", "fofs.translate": f"{n(st['fx'])} {n(st['fy'])}"}
    c.update(eye_ch(st["L"], "L"))
    c.update(eye_ch(st["R"], "R"))
    c.update(mouth_ch(st["mouth"], st["cn"], st["tout"]))
    ff = f"{n1(st['fx'] * S_F)} {n1(st['fy'] * S_F)}"
    c["ffxa.translate"] = c["ffxb.translate"] = ff
    for k in FX_NAMES:
        c[f"fx_{k}.opacity"] = n3(st["ef"].get(k, 0))
    c["wave.translate"] = "0 150"
    c["vein.scale"] = "1 1"
    c["sweat.translate"] = "0 0"
    return c


def sig(e):
    return f"{e['kind']}/{e['arc'] if e['kind'] == 'arc' else ''}/{e['hl'] if e['kind'] == 'ball' else ''}"


# ═════════════════════════ разметка ═════════════════════════
class Ctx:
    def __init__(self, p, ch, anims=None, lean=False):
        self.p, self.ch, self.anims, self.lean = p, ch, anims or {}, lean
        self.by_el = {}
        for k, v in ch.items():
            el, at = k.split(".")
            self.by_el.setdefault(el, []).append((at, v))

    def el(self, tag, X, extra="", inner=""):
        attrs = []
        for at, v in self.by_el.get(X, []):
            if at == "opacity" and v == "0" and self.lean and X not in self.anims:
                return ""
            if at == "opacity" and v == "1":
                continue
            attrs.append(f'transform="{at}({v})"' if at in TK else f'{at}="{v}"')
        body = self.anims.get(X, "") + inner
        a = " ".join([f'id="{self.p}-{X}"'] + attrs + ([extra] if extra else []))
        return f"<{tag} {a}>{body}</{tag}>" if body else f"<{tag} {a}/>"


def eye_markup(side, x):
    cx, cy = EYE_C[side]
    p = x.p
    star = (f'<g transform="translate(-34 -30)">'
            + x.el("g", f"star{side}", "", f'<path d="{star_d(46, 21)}" fill="{WHITE}" stroke="{WHITE}" '
                                           f'stroke-width="10" stroke-linejoin="round"/>')
            + f'</g><path transform="translate(36 42)" d="{sparkle_d(24)}" fill="{WHITE}"/>'
              f'<circle cx="58" cy="-48" r="9" fill="{WHITE}"/>')
    hls = x.el("g", f"hls{side}", "",
               x.el("g", f"hlstd{side}", "", HL_STD) + x.el("g", f"hlstar{side}", "", star)
               + x.el("g", f"hlwet{side}", "", HL_WET) + x.el("g", f"hltiny{side}", "", HL_TINY)
               + x.el("g", f"hlheart{side}", "", HL_HEART))
    ball = (f'<g clip-path="url(#{p}-c{side})"><ellipse rx="{RX}" ry="{RY}" fill="{DARK}"/>'
            f'<g clip-path="url(#{p}-ec)">{hls}</g></g>'
            + x.el("path", f"low{side}", f'fill="none" stroke="{INK}" stroke-width="{LOW_W}" stroke-linecap="round"')
            + x.el("path", f"lid{side}", f'fill="none" stroke="{INK}" stroke-width="{LID_W}" stroke-linecap="round"'))
    inner = (x.el("g", f"ball{side}", "", ball)
             + x.el("path", f"arc{side}", f'fill="none" stroke="{INK}" stroke-width="{ARC_W}" '
                                         f'stroke-linecap="round" stroke-linejoin="round"'))
    return f'<g transform="translate({cx} {cy})">' + x.el("g", f"look{side}", "", x.el("g", f"scl{side}", "", inner)) + "</g>"


def face_defs(x):
    p = x.p
    return (f'<clipPath id="{p}-cL">' + x.el("path", "apL") + "</clipPath>"
            f'<clipPath id="{p}-cR">' + x.el("path", "apR") + "</clipPath>"
            f'<clipPath id="{p}-ec"><ellipse rx="{RX - 1}" ry="{RY - 1}"/></clipPath>'
            + x.el("path", "m")
            + f'<clipPath id="{p}-mcl">' + x.el("path", "mc") + "</clipPath>")


def mouth_markup(x):
    p = x.p
    inner = (x.el("path", "tg", f'fill="{TONGUE}"') + x.el("path", "tt", f'fill="{TEETH}"')
             + x.el("path", "tb", f'fill="{TEETH}"')
             + x.el("path", "gap", f'd="M619 700V744" stroke="{DARK}" stroke-width="7" stroke-linecap="round"'))
    tout = x.el("g", "tout", "", f'<g transform="translate({-TOUT_PIV[0]} {-TOUT_PIV[1]})">{TOUT}</g>')
    return (f'<use href="#{p}-m" fill="{DARK}"/>'
            f'<g clip-path="url(#{p}-mcl)">{inner}</g>'
            + (f'<g transform="translate({TOUT_PIV[0]} {TOUT_PIV[1]})">{tout}</g>' if tout else "")
            + f'<use href="#{p}-m" fill="none" stroke="{DARK}" stroke-width="{MOUTH_W}" stroke-linejoin="round"/>'
            + x.el("path", "cn", f'fill="none" stroke="{INK}" stroke-width="{CORNER_W}" stroke-linecap="round"'))


def face_markup(x):
    return (f'<g transform="matrix({FM[0]} 0 0 {FM[0]} {FM[1]:.2f} {FM[2]:.2f})">'
            + x.el("g", "fofs", "", eye_markup("L", x) + eye_markup("R", x) + mouth_markup(x)) + "</g>")


def centered(x, X, cx, cy, inner):
    return f'<g transform="translate({n1(cx)} {n1(cy)})">' + x.el("g", X, "", f'<g transform="translate({n1(-cx)} {n1(-cy)})">{inner}</g>') + "</g>"


def tint_markup(x):
    p = x.p
    return (x.el("circle", "fx_red", f'cx="500" cy="430" r="{n(R_GOLD)}" fill="url(#{p}-gRed)"')
            + x.el("g", "fx_wave", f'clip-path="url(#{p}-cCoin)"', x.el("g", "wave", "", f'<path d="{WAVE_D}" fill="url(#{p}-gWave)"/>'))
            + x.el("g", "fx_pale", "", f'<circle cx="500" cy="430" r="{n(R_GOLD)}" fill="#E4ECF2" opacity=".58"/>'))


def fx_under(x, anim_tears):
    p = x.p
    return (x.el("circle", "fx_glow", f'cx="500" cy="430" r="{n(R_GOLD)}" fill="url(#{p}-gGlow)"')
            + x.el("g", "ffxa", "", x.el("g", "fx_tears", "", streams(anim_tears))))


def fx_over(x):
    p = x.p
    sx, sy, sr = SWEAT
    sweat = x.el("g", "sweat", "", drop_el(sx, sy, sr))
    vein = centered(x, "vein", *VEIN, stroke(vein_d(*VEIN, 27, 6), INK, 17) + stroke(vein_d(*VEIN, 27, 6), "#E8333B", 9))
    zz = "".join(x.el("g", f"z{i}", "", stroke(zpath(zx, zy, s), INK, max(6, s * .3))) for i, (zx, zy, s) in enumerate(ZZ))
    face_fx = (x.el("g", "fx_blush", "", cheeks(blush_hatch)) + x.el("g", "fx_apples", "", cheeks(apple))
               + x.el("g", "fx_sweat", "", sweat) + x.el("g", "fx_vein", "", vein) + x.el("g", "fx_zz", "", zz))
    rim = "".join(centered(x, f"rs{i}", *bpolar(239, a), f'<path d="{star4(*bpolar(239, a), r)}" fill="{FXWHITE}"/>')
                  for i, (a, r) in enumerate(RIMS))
    spark = "".join(
        f'<g transform="translate({cx} {cy})">' + x.el("g", f"sp{i}", "", x.el("g", f"spr{i}", "",
            f'<circle r="{n1(r * .95)}" fill="url(#{p}-gSpark)"/><path d="{star4(0, 0, r)}" fill="{FXWHITE}"/>')) + "</g>"
        for i, (cx, cy, r) in enumerate(SPARKS))
    puffs = x.el("g", "fx_puff", "", cheeks(puff).replace("P-", p + "-"))
    return x.el("g", "ffxb", "", face_fx) + puffs + x.el("g", "fx_rim", "", rim) + x.el("g", "fx_spark", "", spark)


def figure(x, coin, shine, anim_tears, pre_tint=""):
    inner = coin + pre_tint + tint_markup(x) + shine + fx_under(x, anim_tears) + face_markup(x) + fx_over(x)
    return x.el("g", "jump", "", x.el("g", "tilt", "",
                '<g transform="translate(500 710)">' + x.el("g", "breath", "", x.el("g", "sq", "",
                    f'<g transform="translate(-500 -710)">{inner}</g>')) + "</g>"))


def pick_defs(p, body, extra_defs=()):
    out = []
    for key, mk in list(fx_defs(p)) + list(extra_defs):
        if f"#{p}-{key})" in body or f'#{p}-{key}"' in body:
            out.append(mk)
    return "".join(out)


def svg_doc(p, st=None, ch=None, anims=None, lean=False, vb=VB, coin=None, shine="static", anim_tears=False,
            title="Копейка", attrs="", edge=False, sweep=None):
    x = Ctx(p, ch or channels(st), anims, lean)
    coin_m = coin if coin is not None else CLEAN(p)
    # проход под тонировкой (в «Злится»): красный ложится и на блик, блик не белёсый
    pre = sweep_band(p, sweep[0], sweep[1], sweep[2], alpha=SWEEP_A) if sweep and sweep[3] else ""
    body = figure(x, coin_m, shine_markup(p, shine, sweep), anim_tears, pre)
    if edge:   # ребро для поворота: заглушка-слой (анимированное ребро — в zagruzka.svg)
        body = edge_layer(p) + body
    defs = face_defs(x) + pick_defs(p, body)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}"{" " + attrs if attrs else ""}><title>{title}</title>'
            f"<defs>{defs}</defs>{body}</svg>")


# ═════════════════════════ эмоции ═════════════════════════
N0 = S(E(), mouth="smile")

EMO = [
    ("privet", "Привет", "онбординг, приветствие бота",
     S(E(), mouth="smile", a=-4, dy=-6, sx=0.98, sy=1.02, ef=dict(blush=1, rim=1))),
    ("dovolna", "Довольна", "все в расчёте",
     S(E(kind="arc", arc="happy"), mouth="smileLine", sx=1.03, sy=0.97, ef=dict(blush=1, apples=1))),
    ("ura", "Ура!", "перевод получен",
     S(E(s=1.08, hl="star"), mouth="grin", dy=-4, sx=0.97, sy=1.03, ef=dict(glow=1, spark=1, rim=1))),
    ("smeh", "Смеётся", "успех, шутка",
     S(E(kind="arc", arc="laugh"), mouth="grin", a=5, sx=1.03, sy=0.97)),
    ("dumaet", "Задумалась", "пустой экран, трат ещё нет",
     S(E(look=(18, -20)), mouth="hmm", a=6, fx=14, fy=-10)),
    ("nelovko", "Неловко", "у тебя есть долг",
     S(E(lid="sadS", look=(-16, 14), hloff=(0, 6)), mouth="wavy", a=-4, sx=1.01, sy=0.99, fx=-10, fy=6,
       ef=dict(blush=1, sweat=1))),
    ("oi", "Ой!", "ошибка",
     S(E(s=1.12, hs=1.22), mouth="oi", dy=-8, sx=0.97, sy=1.04, ef=dict(pale=1))),
    ("ispug", "Испугалась", "удаление, опасное действие",
     S(E(s=0.62, hl="tiny"), mouth="o", sx=0.96, sy=1.04, ef=dict(pale=1))),
    ("grust", "Грустит", "из группы вышли, ничего не нашлось",
     S(E(lid="sad", look=(0, 8), hl="wet", hloff=(0, 10)), mouth="sad", a=-3, sx=1.03, sy=0.97, fy=10, ef=dict(tears=1))),
    ("obida", "Обиделась", "долг висит давно (мягко)",
     S(E(lid="sadS", look=(-20, 4), hloff=(0, 6)), mouth="pout", a=-7, fx=-12, fy=4, ef=dict(puff=1))),
    ("zlitsya", "Злится", "долг висит очень давно (редко)",
     S(E(lid="angry", s=0.97, hloff=(4, 14)), mouth="angry", sx=1.04, sy=0.96, ef=dict(red=1, vein=1))),
    ("sonnaya", "Сонная", "загрузка, ожидание",
     S(E(lid="sleepy", hloff=(6, 40), hs=0.9), mouth="oSmall", a=8, fx=6, fy=8, ef=dict(zz=1))),
    ("podmig", "Подмигивает", "подсказка, лайфхак",
     S(E(look=(4, 0)), R=E(kind="arc", arc="happy"), mouth="smirk", a=-5)),
    ("lyubov", "Влюблена", "спасибо, пригласили друга",
     S(E(hl="heart"), mouth="smileS", a=4, dy=-6, ef=dict(blush=1))),
    ("drazn", "Дразнится", "напоминание с юмором",
     S(E(kind="arc", arc="laugh"), mouth="tongue", a=-6)),
    ("hitraya", "Хитрая", "делим долями, хитрый расчёт",
     S(E(lid="sly", low="sly", look=(16, 0), hloff=(-2, 8), hs=0.85), mouth="smirk", a=4)),
    ("tronuta", "Растрогалась", "долг вернули после напоминания",
     S(E(hl="wet", look=(0, -4)), mouth="smileLine", cn=False, a=-3)),
    ("mur", "Мур", "всё спокойно, профиль",
     S(E(kind="arc", arc="happy"), mouth="cat", a=5)),
]


# ═════════════════════════ сцены ═════════════════════════
EIO, EO, EI, LIN = "0.42 0 0.58 1", "0.2 0.6 0.4 1", "0.5 0 0.9 0.5", "0 0 1 1"
CLO = dict(lid="closed", low="closed")


def blink_keys(t, st, dur=(60, 110, 200)):
    half = mod(st, eyes=dict(lid="sleepy"))
    closed = mod(st, eyes=CLO)
    return [(t + dur[0], half, EI), (t + dur[1], closed, EI), (t + dur[2], st, EO)]


def scene_anims(keys, D):
    keys = sorted(keys, key=lambda k: k[0])
    assert keys[0][0] == 0 and keys[-1][0] == D, (keys[0][0], keys[-1][0])
    chs = [channels(k[1]) for k in keys]
    anims = {}
    for ck in chs[0]:
        vals = [c[ck] for c in chs]
        if all(v == vals[0] for v in vals):
            continue
        pts = [(keys[i][0], vals[i], keys[i][2]) for i in range(len(keys))
               if i in (0, len(keys) - 1) or not (vals[i - 1] == vals[i] == vals[i + 1])]
        pts = [(t, v, LIN if i and pts[i - 1][1] == v else sp) for i, (t, v, sp) in enumerate(pts)]
        kt = ";".join(n3(t / D) for t, _, _ in pts)
        el, at = ck.split(".")
        common = (f'dur="{D / 1000:g}s" repeatCount="indefinite" keyTimes="{kt}" '
                  f'values="{";".join(v for _, v, _ in pts)}" calcMode="spline" '
                  f'keySplines="{";".join(sp for _, _, sp in pts[1:])}"')
        if at in TK:
            a = f'<animateTransform attributeName="transform" type="{at}" {common}/>'
        else:
            a = f'<animate attributeName="{at}" {common}/>'
        anims[el] = anims.get(el, "") + a
    return chs[0], anims


def with_ef(keys, ef):
    return [(t, mod(st, ef=ef), e) for t, st, e in keys]


def twinkle_rim(D, t0, step=260, life=420, lo=.45, hi=1.35):
    out = {}
    for i in range(len(RIMS)):
        t = t0 + i * step
        out[f"rs{i}"] = a_sc([(0, lo), (t, lo), (t + life * .4, hi, "oo"), (t + life, lo, "io")], D)
    return out


def pop_sparks(D, t0, order=(0, 2, 1, 4, 3, 5), step=210, life=560):
    out = {}
    for i in range(len(SPARKS)):
        t = t0 + order[i] * step
        out[f"sp{i}"] = a_sc([(0, 0), (t, 0), (t + 150, 1.3, "oo"), (t + 280, 1.05, "io"), (t + life, 0, "i")], D)
        out[f"spr{i}"] = a_tr("rotate", [(0, -30), (t, -30), (t + life, 45, "o")], D, fmt=lambda v: f(v, 1))
    return out


def sc_rest():
    D = REST_D
    k = ([(0, N0, LIN), (1700, N0, LIN)] + blink_keys(1700, N0) + [(4600, N0, LIN)] + blink_keys(4600, N0)
         + [(D, N0, LIN)])
    extra = {"breath": a_tr("scale", [(0, (1, 1)), (1600, (1.008, .988), "io"), (3200, (1, 1), "io"),
                                      (4800, (1.008, .988), "io"), (6400, (1, 1), "io")], D,
                            fmt=lambda v: f"{f(v[0], 3)} {f(v[1], 3)}")}
    return D, k, extra, "rest"


def sc_privet():
    D = 3200
    calm = S(E(), mouth="smileS")
    hi = S(E(), mouth="smile")
    k = [(0, calm, LIN), (240, calm, LIN),
         (400, mod(calm, eyes=dict(lid="think", hloff=(0, 8)), sx=1.08, sy=0.9), EIO),
         (540, mod(hi, dy=-34, sx=0.94, sy=1.07), EO),
         (680, mod(hi, dy=-56, a=-3), EO),
         (820, mod(hi, dy=-12, sx=0.97, sy=1.03, a=-2), EI),
         (880, mod(hi, sx=1.08, sy=0.91), EO),
         (1020, mod(hi, sx=0.98, sy=1.02, a=4), EIO),
         (1240, mod(hi, a=-5, dy=-4), EIO),
         (1460, mod(hi, a=4, dy=-2), EIO),
         (1660, mod(hi, a=-3), EIO),
         (1860, mod(hi, a=-4, dy=-6, sx=0.98, sy=1.02), EIO)]
    priv = mod(hi, a=-4, dy=-6, sx=0.98, sy=1.02)
    k += blink_keys(2150, priv)
    k += [(2650, priv, LIN), (2950, calm, EIO), (3200, calm, LIN)]
    k = with_ef(k, dict(blush=1, rim=1))
    extra = {"fx_blush": a_op([(0, 0), (620, 0), (1300, 1, "io"), (2650, 1), (3050, 0, "io")], D),
             "fx_rim": a_op([(0, 0), (640, 0), (760, 1, "o"), (2600, 1), (2900, 0, "io")], D)}
    extra.update(twinkle_rim(D, 700, step=280))
    return D, k, extra, "static"


def sc_ura():
    D = 3000
    star = lambda **kw: mod(S(E(s=1.1, hl="star"), mouth="grin"), **kw)  # noqa: E731
    k = [(0, N0, LIN), (240, N0, LIN),
         (420, mod(N0, eyes=CLO, mouth="smileLine", sx=1.09, sy=0.89), EIO),
         (450, mod(N0, eyes=dict(CLO, hl="star", s=1.1), mouth="smileLine", sx=1.09, sy=0.89), LIN),
         (560, star(dy=-30, sx=0.93, sy=1.08), EO),
         (700, star(dy=-62, sx=1.0, sy=1.0, eyes=dict(star=(18, 1.15))), EO),
         (830, star(dy=-24, sx=0.95, sy=1.06, eyes=dict(star=(30, 1.05))), EI),
         (900, star(dy=0, sx=1.1, sy=0.89, eyes=dict(star=(36, 1.0))), EO),
         (1060, star(dy=-6, sx=0.97, sy=1.03, eyes=dict(star=(44, 1.18))), EO),
         (1180, star(sx=1.0, sy=1.0, eyes=dict(star=(52, 1.0))), EIO),
         (1320, star(sx=1.05, sy=0.94, eyes=dict(star=(56, 1.0))), EIO),
         (1480, star(dy=-32, sx=0.98, sy=1.02, eyes=dict(star=(64, 1.18))), EO),
         (1620, star(dy=0, sx=1.06, sy=0.94, eyes=dict(star=(72, 1.0))), EI),
         (1760, star(eyes=dict(star=(72, 1.0))), EO),
         (2360, star(eyes=dict(star=(72, 1.0))), LIN),
         (2460, star(eyes=dict(CLO, star=(72, 1.0))), EI),
         (2490, mod(N0, eyes=CLO, mouth="grin"), LIN),
         (2680, N0, EO), (3000, N0, LIN)]
    k = with_ef(k, dict(glow=1, spark=1, rim=1))
    extra = {"fx_glow": a_op([(0, 0), (440, 0), (700, 1, "o"), (2360, .85), (2700, 0, "io")], D),
             "fx_rim": a_op([(0, 0), (460, 0), (560, 1, "o"), (2400, 1), (2650, 0, "io")], D)}
    extra.update(pop_sparks(D, 560))
    extra.update(twinkle_rim(D, 600, step=230))
    return D, k, extra, "static"


def sc_angry():
    D = 3600
    ang = S(E(lid="angry", s=0.97, hloff=(4, 14)), mouth="angry")
    k = [(0, N0, LIN), (320, N0, LIN),
         (460, mod(N0, eyes=dict(lid="think", hloff=(0, 8)), mouth="hmm", sx=1.01, sy=0.99), EIO),
         (600, mod(ang, sx=1.07, sy=0.92), EO),
         (720, mod(ang, sx=1.0, sy=1.0, dy=-10), EO),
         (840, mod(ang, sx=1.04, sy=0.96), EIO)]
    t, up = 900, True
    while t <= 1880:
        k.append((t, mod(ang, sx=1.03 if up else 1.045, sy=0.975 if up else 0.955, dy=-4 if up else 0), LIN))
        up = not up
        t += 70
    k += [(2000, mod(ang, sx=1.08, sy=0.91), EIO),
          (2150, mod(ang, sx=0.97, sy=1.04, dy=-30), EO),
          (2290, mod(ang, sx=1.07, sy=0.93, dy=0), EI),
          (2420, mod(ang, sx=1, sy=1), EO),
          (3240, mod(ang), LIN),
          (3380, mod(N0, eyes=dict(lid="think", hloff=(0, 8)), mouth="hmm"), EIO),
          (3520, N0, EIO), (3600, N0, LIN)]
    k = with_ef(k, dict(wave=1, vein=1))
    vk = [(0, 0), (640, 0), (820, 1.35, "o"), (940, 1, "io")]
    for tt in range(1150, 3000, 300):
        vk += [(tt, 1.22, "io"), (tt + 150, 1, "io")]
    vk += [(3240, 1), (3460, 0, "i")]
    extra = {"wave": a_tr("translate", [(0, (-110, 730)), (330, (-96, 730)), (1300, (-20, 150), "io"),
                                        (3050, (80, 150)), (3550, (110, 730), "i")], D),
             "vein": a_sc(vk, D)}
    return D, k, extra, "static"


def sc_grust():
    D = 2800
    g = S(E(lid="sad", look=(0, 8), hl="wet", hloff=(0, 10)), mouth="sad", a=-3, fy=10)
    k = [(0, g, LIN)]

    def sob(t, pw):
        k.extend([(t, g, EO),
                  (t + 110, mod(g, sx=1 + .045 * pw, sy=1 - .065 * pw, dy=3 * pw, mouth="sadW"), EO),
                  (t + 260, mod(g, sx=1 - .02 * pw, sy=1 + .03 * pw, dy=-2 * pw, mouth="sadW"), EIO),
                  (t + 420, g, EIO)])
    sob(150, 1)
    sob(650, .8)
    k += blink_keys(1150, g, dur=(80, 150, 300))
    sob(2330, 1.1)
    k += [(D, g, LIN)]
    k = with_ef(k, dict(tears=1))
    return D, k, {}, "static"


def sc_nelovko():
    D = 3200
    nel = S(E(lid="sadS", look=(-16, 14), hloff=(0, 6)), mouth="wavy", a=-4, sx=1.01, sy=0.99, fx=-10, fy=6)
    k = [(0, N0, LIN), (250, N0, LIN),
         (420, mod(N0, mouth="hmm", eyes=dict(look=(-8, 6))), EIO),
         (650, nel, EIO),
         (1500, mod(nel, eyes=dict(look=(-22, 16)), a=-5), EIO)]
    k += blink_keys(1900, mod(nel, eyes=dict(look=(-22, 16)), a=-5))
    k += [(2650, mod(nel, eyes=dict(look=(-16, 14))), EIO),
          (2950, mod(N0, mouth="hmm"), EIO), (3150, N0, EIO), (3200, N0, LIN)]
    k = with_ef(k, dict(blush=1, sweat=1))
    sx, sy, _ = SWEAT
    extra = {"fx_blush": a_op([(0, 0), (700, 0), (1250, 1, "io"), (2600, 1), (3000, 0, "io")], D),
             "fx_sweat": a_op([(0, 0), (520, 0), (560, 1), (2300, 1), (2600, 0, "io")], D),
             "sweat": a_tr("translate", [(0, (0, -6)), (520, (0, -6)), (820, (0, 2), "oo"), (950, (0, 0), "io"),
                                         (2300, (4, 26), "fall"), (2600, (5, 31), "o")], D)}
    return D, k, extra, "static"


def sc_sleep():
    D = 4200
    base = S(E(), mouth="smileLine", cn=False)
    drowsy = mod(base, eyes=dict(lid="drowsy", hloff=(2, 20)), a=2)
    sleepy = mod(base, eyes=dict(lid="sleepy", hloff=(6, 40), hs=0.9), a=4)
    closed = dict(lid="closed", low="closed", hloff=(6, 40))
    asleep = mod(sleepy, eyes=closed, mouth="oSmall", a=9, dy=6, fx=6, fy=8)
    k = [(0, N0, LIN), (300, N0, LIN),
         (600, drowsy, EIO), (800, drowsy, LIN),
         (1050, mod(drowsy, eyes=closed, a=3), EI), (1250, mod(drowsy, eyes=closed, a=3), LIN),
         (1500, sleepy, EO),
         (1750, mod(sleepy, eyes=dict(lid="heavy"), mouth="o", sx=0.98, sy=1.03, a=5), EIO),
         (2000, mod(sleepy, eyes=dict(lid="heavy"), mouth="o", sx=0.98, sy=1.03, a=5), LIN),
         (2300, asleep, EIO),
         (2650, mod(asleep, sx=1.015, sy=0.985), EIO),
         (3000, asleep, EIO),
         (3350, mod(asleep, sx=1.015, sy=0.985), EIO),
         (3480, asleep, EIO),
         (3600, S(E(s=1.1, hs=1.2), mouth="oi", dy=-20, sx=0.96, sy=1.05), EO),
         (3760, S(E(s=1.06, hs=1.1), mouth="o", sx=1.05, sy=0.95), EI),
         (3920, N0, EO), (4200, N0, LIN)]
    k = with_ef(k, dict(zz=1))
    extra = {}
    for i in range(3):
        t0 = 2250 + i * 260
        extra[f"z{i}"] = (a_op([(0, 0), (t0, 0), (t0 + 200, 1, "o"), (3480, 1), (3560, 0)], D)
                          + a_tr("translate", [(0, (-6, 6)), (t0, (-6, 6)), (3480, (-2, -4), "o"), (3560, (-2, -5))], D))
    return D, k, extra, "static"


def sc_wink():
    D = 3000
    wc = dict(lid="closed", low="closed")
    smirk = dict(mouth="smirk", a=-7)
    k = [(0, N0, LIN), (300, N0, LIN),
         (420, mod(N0, sx=1.03, sy=0.97), EIO),
         (480, mod(N0, R=dict(lid="sleepy"), sx=1.03, sy=0.97, mouth="smirk", a=-3), EI),
         (540, mod(N0, R=wc, sx=1.0, sy=1.0, mouth="smirk", a=-5, dy=-4), EI),
         (560, mod(N0, R=dict(wc, kind="arc", arc="closed"), mouth="smirk", a=-5, dy=-4), LIN),
         (720, mod(N0, R=dict(kind="arc", arc="happy"), sx=0.98, sy=1.02, dy=-10, **smirk), EO),
         (860, mod(N0, R=dict(kind="arc", arc="happy"), sx=1.02, sy=0.98, dy=0, **smirk), EIO),
         (980, mod(N0, R=dict(kind="arc", arc="happy"), **smirk), EIO),
         (1550, mod(N0, R=dict(kind="arc", arc="happy"), **smirk), LIN),
         (1680, mod(N0, R=dict(wc, kind="arc", arc="closed"), mouth="smirk", a=-4), EIO),
         (1700, mod(N0, R=wc, mouth="smirk", a=-4), LIN),
         (1860, mod(N0, a=-1), EO), (2000, N0, EIO), (3000, N0, LIN)]
    return D, k, {}, "static"


# ───────── C: 3D (поворот на ребро, наклон-касание) ─────────
H2 = 23.0
LIGHT = (-0.42, -0.55, 0.72)
_n = math.sqrt(sum(v * v for v in LIGHT))
L3 = tuple(v / _n for v in LIGHT)
Hv = (L3[0], L3[1], L3[2] + 1)
_n = math.sqrt(sum(v * v for v in Hv))
Hv = tuple(v / _n for v in Hv)


def smooth(u):
    u = min(max(u, 0), 1)
    return u * u * u * (u * (6 * u - 15) + 10)


def spin_state(t, kind):
    """θ (°), подпрыгивание, sx, sy, крен (°)."""
    if kind == "tap":   # касание: толчок → затухающее качание по Y (из «наклона» C), короткий присед
        T0 = 300
        th, jump, sx, sy, roll = 0.0, 0.0, 1.0, 1.0, 0.0
        if t >= T0:
            u = (t - T0) / 1000
            env = math.exp(-3.0 * u)
            w = math.sin(2 * math.pi * 1.45 * u)
            th = 34 * env * w
            roll = -2.6 * env * math.sin(2 * math.pi * 1.45 * u - 0.6)
            if u > 1.75:
                th = roll = 0.0
        if T0 - 80 <= t < T0 + 220:
            v = (t - T0 + 80) / 300
            e = math.sin(math.pi * v)
            sx, sy = 1 + 0.045 * e, 1 - 0.055 * e
        return th, jump, sx, sy, roll
    T0, T1, T2, T3 = 420, 600, 1420, 1580
    th, jump, sx, sy = 0.0, 0.0, 1.0, 1.0
    if T0 <= t < T1:
        u = (t - T0) / (T1 - T0)
        e = smooth(u / 0.75) if u < .75 else 1 - smooth((u - .75) / .25)
        sx, sy = 1 + 0.06 * e, 1 - 0.07 * e
    elif T1 <= t < T2:
        u = (t - T1) / (T2 - T1)
        th = 360 * (u + (0.5 - 0.5 * math.cos(math.pi * u))) / 2
        jump = -54 * math.sin(math.pi * u)
        st = max(0, 1 - u / 0.25) if u < .25 else (max(0, (u - .82) / .18))
        sx, sy = 1 - 0.035 * st, 1 + 0.045 * st
    elif T2 <= t < T3 + 380:
        u = (t - T2) / 380
        e = math.exp(-4.2 * u) * math.cos(2.6 * math.pi * u)
        sx, sy = 1 + 0.07 * e, 1 - 0.08 * e
        th = 360
    return th, jump, sx, sy, 0.0


def ellipse_half(xc, rx, side):
    k, R = 0.5523, R_OL
    if side > 0:
        return (f"C{f(xc + k * rx)} {f(CY - R)} {f(xc + rx)} {f(CY - k * R)} {f(xc + rx)} {f(CY)}"
                f"C{f(xc + rx)} {f(CY + k * R)} {f(xc + k * rx)} {f(CY + R)} {f(xc)} {f(CY + R)}")
    return (f"C{f(xc - k * rx)} {f(CY + R)} {f(xc - rx)} {f(CY + k * R)} {f(xc - rx)} {f(CY)}"
            f"C{f(xc - rx)} {f(CY - k * R)} {f(xc - k * rx)} {f(CY - R)} {f(xc)} {f(CY - R)}")


def hull_d(th):
    r = math.radians(th)
    s, c = math.sin(r), math.cos(r)
    rx = R_OL * max(abs(c), 0.002)
    xl, xr = CX - H2 * abs(s), CX + H2 * abs(s)
    d = (f"M{f(xl)} {f(CY - R_OL)}L{f(xr)} {f(CY - R_OL)}" + ellipse_half(xr, rx, 1)
         + f"L{f(xl)} {f(CY + R_OL)}" + ellipse_half(xl, rx, -1) + "Z")
    return re.sub(r"\d+\.\d+", lambda mm: str(round(float(mm.group()))), d)


def edge_layer(p):
    return (f'<g id="{p}-edge" opacity="0"><path d="{hull_d(60)}" fill="{C_EDGE}" stroke="{C_OUT}" '
            f'stroke-width="{OL_W}" stroke-linejoin="round"/></g>')


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def spin3d(p, D, kind, face, coin_ref, sweep_m=""):
    step = 40 if kind == "tap" else 30
    ts = set(range(0, D + 1, step))
    if kind == "spin":
        ts = {t for t in ts if 400 <= t <= 2000} | {0, D}
        for target in (90, 270):
            lo, hi = 600.0, 1420.0
            for _ in range(40):
                mid = (lo + hi) / 2
                if spin_state(mid, kind)[0] < target:
                    lo = mid
                else:
                    hi = mid
            ts |= {round(lo, 2), round(hi + 0.02, 2)}
    else:
        ts = {t for t in ts if t <= 2200} | {D}
    ts = sorted(ts)

    ch = {k: [] for k in "fig sq dx sc front back hull ecx erx dark light gl tl br eshade ehi_y ehi_op roll".split()}
    for t in ts:
        th, jump, sx, sy, roll = spin_state(t, kind)
        r = math.radians(th)
        s, c = math.sin(r), math.cos(r)
        front = c >= 0 if kind == "spin" else True
        if kind == "spin" and abs(c) < 1e-6:
            front = (t < ts[len(ts) // 2]) if th < 180 else False
        nvis = (s, 0, c) if front else (-s, 0, -c)
        dx = H2 * s if front else -H2 * s
        rx = R_OL * max(abs(c), 0.002)
        d0 = L3[2]
        dif = dot(nvis, L3)
        dark = min(.26, max(0, (d0 - dif) * 0.6))
        light = min(.38, max(0, (dif - d0) * 1.8))
        nx = nvis[0]
        sig_ = -1 if s > 0 else 1
        n_mid = (sig_ * c, 0, -sig_ * s)
        edif = dot(n_mid, L3)
        eshade = min(.55, max(0, (0.55 - edif) * 0.75))
        A = Hv[0] * c - Hv[2] * s
        B = Hv[1]
        ph = math.atan2(B, A)
        if math.cos(ph) * sig_ < 0:
            ph = -math.pi / 2 if B < 0 else math.pi / 2
        val = A * math.cos(ph) + B * math.sin(ph)
        ehi_y = CY + R_OL * math.sin(ph)
        ehi_op = min(1, max(0, (val - 0.62) / 0.3)) ** 1.3 * min(1, abs(s) * 4)
        ch["fig"].append(f"0 {f(jump)}")
        ch["sq"].append(f"{f(sx, 3)} {f(sy, 3)}")
        ch["roll"].append(f(roll, 2))
        ch["dx"].append(f"{f(dx, 2)} 0")
        ch["sc"].append(f"{f(max(abs(c), 0.002), 4)} 1")
        ch["front"].append("1" if front else "0")
        ch["back"].append("0" if front else "1")
        ch["hull"].append(hull_d(th))
        ch["ecx"].append(f(CX + dx, 2))
        ch["erx"].append(f(rx, 2))
        ch["dark"].append(f(dark, 3))
        ch["light"].append(f(light, 3))
        ch["gl"].append(f"{f(-230 * nx)} 0")
        ch["tl"].append(f"{f(-70 * nx, 1)} {CX} {CY}")
        ch["br"].append(f"{f(70 * nx, 1)} {CX} {CY}")
        ch["eshade"].append(f(eshade, 3))
        ch["ehi_y"].append(f"0 {f(ehi_y)}")
        ch["ehi_op"].append(f(ehi_op, 3))

    Sm = lambda attr, key, **kw: sampled(attr, ts, ch[key], D, **kw)  # noqa: E731
    T = lambda key, typ: sampled("transform", ts, ch[key], D, tag="animateTransform", extra=f' type="{typ}"')  # noqa: E731

    NK = 28
    stops = []
    for i in range(NK):
        ph = -90 + (i + 0.5) * 180 / NK
        o = (math.sin(math.radians(ph)) + 1) / 2
        w = 2.6 / (2 * R_OL)
        stops += [(o - 1.6 * w, "e"), (o - 0.5 * w, "d"), (o + 0.4 * w, "d"), (o + 1.1 * w, "l"), (o + 2.2 * w, "e")]
    stops = [(min(max(o, 0), 1), c) for o, c in stops]
    knurl = (f'<linearGradient id="{p}-knurl" gradientUnits="userSpaceOnUse" x1="0" y1="{f(CY - R_OL)}" x2="0" y2="{f(CY + R_OL)}">'
             + "".join(f'<stop offset="{o:.4f}" class="{p}{c}"/>' for o, c in stops) + "</linearGradient>")
    ehi = (f'<linearGradient id="{p}-ehi" gradientUnits="userSpaceOnUse" x1="0" y1="-70" x2="0" y2="70">'
           + T("ehi_y", "translate").replace('attributeName="transform"', 'attributeName="gradientTransform"')
           + f'<stop offset="0" stop-color="{C_WHITE}" stop-opacity="0"/><stop offset=".4" stop-color="{C_WHITE}" stop-opacity=".85"/>'
           f'<stop offset=".6" stop-color="{C_WHITE}" stop-opacity=".85"/><stop offset="1" stop-color="{C_WHITE}" stop-opacity="0"/>'
           "</linearGradient>")
    style = f"<style>.{p}e{{stop-color:{C_EDGE}}}.{p}d{{stop-color:{C_DEEP}}}.{p}l{{stop-color:{C_LIGHT}}}</style>"
    defs = style + knurl + ehi + f'<path id="{p}-hull" d="{ch["hull"][0]}">{Sm("d", "hull")}</path>'

    edge = (f'<use href="#{p}-hull" fill="url(#{p}-knurl)"/>'
            f'<use href="#{p}-hull" fill="{C_OUT2}" opacity="0">{Sm("opacity", "eshade")}</use>'
            f'<use href="#{p}-hull" fill="url(#{p}-ehi)" opacity="0">{Sm("opacity", "ehi_op")}</use>'
            f'<use href="#{p}-hull" fill="none" stroke="{C_OUT}" stroke-width="{OL_W}" stroke-linejoin="round"/>')
    inner_gloss = gloss(p, stripe_anim=T("gl", "translate"), tl_anim=T("tl", "rotate"), br_anim=T("br", "rotate"))
    shade = (f'<circle cx="{CX}" cy="{CY}" r="{IN_R + 2}" fill="{C_OUT2}" opacity="0">{Sm("opacity", "dark")}</circle>'
             f'<circle cx="{CX}" cy="{CY}" r="{IN_R + 2}" fill="{C_LIGHT}" opacity="0">{Sm("opacity", "light")}</circle>')

    def side(content, key):
        return (f'<g opacity="{ch[key][0]}">{Sm("opacity", key, calc="discrete")}'
                f'<g transform="translate({CX} {CY})"><g>{T("dx", "translate")}<g>{T("sc", "scale")}'
                f'<g transform="translate({-CX} {-CY})">{content}</g></g></g></g></g>')

    parts = [edge, side(coin_ref + shade + sweep_m + inner_gloss + face, "front")]
    if kind == "spin":
        parts.append(side(coin_ref + shade + inner_gloss, "back"))
    parts.append(f'<ellipse cx="{CX}" cy="{CY}" rx="{R_OL}" ry="{R_OL}" fill="none" stroke="{C_OUT}" stroke-width="{OL_W}">'
                 f'{Sm("cx", "ecx")}{Sm("rx", "erx")}</ellipse>')
    body = "".join(parts)
    body = (f'<g>{T("fig", "translate")}<g transform="translate({CX} {f(BOTTOM)})"><g>{T("sq", "scale")}'
            f'<g>{T("roll", "rotate")}<g transform="translate({-CX} {f(-BOTTOM)})">{body}</g></g></g></g></g>')
    return defs, body


def sc_spin():
    D = 3000
    k = [(0, N0, LIN), (420, N0, LIN), (560, mod(N0, eyes=dict(lid="think", hloff=(0, 8))), EIO),
         (1500, mod(N0, eyes=dict(lid="think", hloff=(0, 8))), LIN), (1700, N0, EO), (2050, N0, LIN)]
    k += blink_keys(2050, N0) + [(D, N0, LIN)]
    return D, k, {}, "spin"


def sc_tap():
    D = 2800
    wc = dict(lid="closed", low="closed")
    joy = mod(N0, eyes=dict(kind="arc", arc="happy"), mouth="grin")
    k = [(0, N0, LIN), (260, N0, LIN),
         (320, mod(N0, eyes=wc), EI),
         (340, mod(N0, eyes=dict(wc, kind="arc", arc="closed")), LIN),
         (480, joy, EO),
         (1300, joy, LIN),
         (1420, mod(N0, eyes=dict(wc, kind="arc", arc="closed"), mouth="smile"), EIO),
         (1440, mod(N0, eyes=wc), LIN),
         (1600, N0, EO), (D, N0, LIN)]
    k = with_ef(k, dict(blush=1))
    extra = {"fx_blush": a_op([(0, 0), (380, 0), (700, 1, "o"), (1450, 1), (1850, 0, "io")], D)}
    return D, k, extra, "tap"


SCENES = [
    ("pokoy", "Покой", "дыхание, моргание, блеск «всё вместе»", sc_rest, [0, 1500, 1700, 1820, 3800, 4560]),
    ("privet", "Привет", "прыжок, улыбка, румянец ///", sc_privet, [0, 400, 680, 880, 1240, 2330]),
    ("ura", "Ура!", "восторг: звёзды, искорки, сияние", sc_ura, [0, 420, 700, 900, 1480, 2580]),
    ("zlitsya", "Злится", "краснеет волной, венка", sc_angry, [0, 600, 1400, 2150, 2900, 3400]),
    ("grust", "Грустит", "всхлипы, ручейки слёз", sc_grust, [0, 260, 700, 1300, 1870, 2500]),
    ("nelovko", "Неловко", "румянец ///, капля пота", sc_nelovko, [0, 650, 1450, 2000, 2300, 2560]),
    ("zasypaet", "Засыпает", "веки, зевок, z z", sc_sleep, [0, 800, 1750, 2600, 2970, 3640]),
    ("podmig", "Подмигивает", "подмигнуть и ухмыльнуться", sc_wink, [0, 480, 560, 720, 1200, 2510]),
    ("zagruzka", "Загрузка", "поворот на ребро", sc_spin, [0, 560, 800, 920, 1080, 2490]),
    ("kasanie", "Касание", "наклон от касания", sc_tap, [0, 320, 440, 640, 1300, 2250]),
]

# Один широкий мягкий проход за круг (C, 1б): (начало, конец, под тонировкой). В спокойный момент сцены;
# до и после прохода полоса стоит за силуэтом, поэтому стык цикла бесшовный.
SWEEP = {
    "sc_privet": (1880, 2780, False),     # после покачивания, в позе «привет» (моргание не мешает)
    "sc_ura": (2180, 2980, False),        # после прыжков и всех искр, на выдохе восторга
    "sc_angry": (2450, 3350, True),       # в паузе злости после подскока, под красной тонировкой
    "sc_grust": (1440, 2300, False),      # между морганием и последним всхлипом
    "sc_nelovko": (1000, 1900, False),    # пока смотрит в сторону, до моргания
    "sc_sleep": (2520, 3420, False),      # во сне, до пробуждения
    "sc_wink": (2060, 2960, False),       # после подмигивания, в покое
    "sc_spin": (2040, 2940, False),       # после приземления, монета стоит лицом
    "sc_tap": (1800, 2700, False),        # после затухания наклона
}


def scene_svg(p, fn, page=False, title="Копейка"):
    D, keys, extra, kind = fn()
    sw = SWEEP.get(fn.__name__)
    sweep = (sw[0], sw[1], D, sw[2]) if sw else None
    ch0, anims = scene_anims(keys, D)
    for el, s in extra.items():
        anims[el] = anims.get(el, "") + s
    if kind in ("spin", "tap"):
        x = Ctx(p, ch0, anims, lean=True)
        face = face_markup(x) + fx_over(x)
        coin_ref = '<use href="#coinBody"/>' if page else f'<use href="#{p}-coin"/>'
        sm = sweep_band(p, sweep[0], sweep[1], D, alpha=SWEEP_A) if sweep else ""
        sdefs, body = spin3d(p, D, "spin" if kind == "spin" else "tap", face, coin_ref, sm)
        own = "" if page else CLEAN(p)
        alldefs = face_defs(x) + pick_defs(p, body + own) + own + sdefs
        return D, (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{VB_SCENE}"><title>{title}</title>'
                   f"<defs>{alldefs}</defs>{body}</svg>")
    coin = '<use href="#coinBody"/>' if page else None
    return D, svg_doc(p, ch=ch0, anims=anims, lean=True, vb=VB_SCENE, coin=coin, anim_tears=True,
                      shine="rest" if kind == "rest" else "static", title=title, sweep=sweep)


def live_anims():
    """Живые мелочи на большой монете страницы (сами по себе, независимо от эмоции)."""
    out = {"breath": a_tr("scale", [(0, (1, 1)), (1600, (1.008, .988), "io"), (3200, (1, 1), "io")], 3200,
                          fmt=lambda v: f"{f(v[0], 3)} {f(v[1], 3)}")}
    out.update(twinkle_rim(3000, 200, step=420, life=520, lo=.55, hi=1.2))
    for i in range(len(SPARKS)):
        t = 300 + [0, 2, 1, 4, 3, 5][i] * 300
        out[f"sp{i}"] = a_sc([(0, .8), (t, .8), (t + 220, 1.2, "oo"), (t + 600, .8, "io")], 2600)
    for i in range(3):
        t0 = i * 400
        out[f"z{i}"] = a_tr("translate", [(0, (0, 4)), (t0, (0, 4)), (t0 + 900, (-2, -5), "io"), (t0 + 1500, (0, 4), "io")], 2400)
    return out


# ═════════════════════════ сборка ═════════════════════════
def gz(s):
    return len(gzip.compress(s.encode(), 9))


def main():
    for d in (WEB / "emotions", WEB / "scenes", PRE):
        d.mkdir(parents=True, exist_ok=True)
    sizes = {}

    rig = svg_doc("k", N0, shine="rest", anim_tears=True, edge=True, title="Копейка — риг (все слои)")
    (WEB / "rig.svg").write_text(rig)
    sizes["rig"] = (len(rig.encode()), gz(rig))

    for eid, label, use, st in EMO:
        s = svg_doc("k", st, lean=True, title=f"Копейка — {label}")
        (WEB / f"emotions/{eid}.svg").write_text(s)
        sizes[eid] = (len(s.encode()), gz(s))

    scene_data = []
    for sid, label, note, fn, keyt in SCENES:
        D, s = scene_svg("k", fn, title=f"Копейка — {label}")
        (WEB / f"scenes/{sid}.svg").write_text(s)
        sizes["scene_" + sid] = (len(s.encode()), gz(s))
        scene_data.append(dict(id=sid, label=label, note=note, dur=D, keyt=keyt))

    data = dict(emotions=[dict(id=e[0], label=e[1], use=e[2], fx=[FX_LABEL[k] for k, v in e[3]["ef"].items() if v])
                          for e in EMO],
                scenes=scene_data, sizes=sizes)
    (PRE / "data.json").write_text(json.dumps(data, ensure_ascii=False, indent=1))
    build_index(scene_data)
    sizes["index.html"] = (len((PRE / "index.html").read_bytes()), gz((PRE / "index.html").read_text()))
    data["sizes"] = sizes
    (PRE / "data.json").write_text(json.dumps(data, ensure_ascii=False, indent=1))
    print("зазор щёк до канавки (L, R):", puff_gap())
    for k, (b, g) in sizes.items():
        print(f"{k:18s} {b:8d} B  gzip {g:7d} B")


def build_index(scene_data):
    closed_all = channels(S(E(lid="closed", low="closed")))
    eye_keys = [k for k in closed_all if k.split(".")[0][-1] in "LR"]
    closed = {k: closed_all[k] for k in eye_keys if not k.startswith(("look", "scl"))}
    emos = [dict(id=e[0], label=e[1], use=e[2], fx=[FX_LABEL[k] for k, v in e[3]["ef"].items() if v],
                 ch=channels(e[3]), sig={"L": sig(e[3]["L"]), "R": sig(e[3]["R"])}) for e in EMO]
    data = dict(emotions=emos, closed=closed)

    use = '<use href="#coinBody"/>'
    stage = svg_doc("st", EMO[0][3], coin=use, shine="rest", anim_tears=True, anims=live_anims(),
                    attrs='class="stage-svg"')
    thumbs = "".join(
        f'<button class="thumb" data-emo="{i}" title="{e[2]}">'
        + svg_doc(f"t{i}", e[3], lean=True, coin=use) + f"<span>{e[1]}</span></button>"
        for i, e in enumerate(EMO))
    scenes_html = ""
    for i, (sid, label, note, fn, keyt) in enumerate(SCENES):
        D, s = scene_svg(f"s{i}", fn, page=True)
        scenes_html += (f'<figure class="scene"><div class="scene-box">{s}</div>'
                        f'<figcaption><b>{label}</b> · {D / 1000:g} с<br><span>{note}</span></figcaption></figure>')
    hidden = f'<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>{rim_clip("pg")}<g id="coinBody">{CLEAN("pg")}</g></defs></svg>'
    tpl = (HERE / "index.tpl.html").read_text()
    html = (tpl.replace("%HIDDEN%", hidden).replace("%STAGE%", stage).replace("%THUMBS%", thumbs)
            .replace("%SCENES%", scenes_html)
            .replace("%DATA%", json.dumps(data, ensure_ascii=False, separators=(",", ":"))))
    (PRE / "index.html").write_text(html)


if __name__ == "__main__":
    main()
