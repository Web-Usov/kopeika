"""Каркас SVG-маскота Копейки: палитра и общие детали.

Образы рисуются в design/mascot/svg/poses/<имя>.py функцией draw(r, pid),
где r — этот модуль, pid — префикс для id (уникальность, если несколько SVG на странице).
Сборка: python3 design/mascot/svg/build.py  →  web/public/brand/mascot/<имя>.svg
Холст 512×512. Классы k-* — точки привязки для CSS-анимации (см. animations/motion.md).
"""

import math

C = dict(
    main="#D97E3A",  # медь: лицо, руки, ноги
    light="#F9BC80",  # блик
    dark="#B45A20",
    edge="#994917",  # торец монеты
    line="#682E0D",  # контур
    ink="#311202",  # глаза, рот, брови
    white="#FFF8EE",  # белки
    tongue="#C4623A",
    band="#C9702F",  # полоса ободка
    dot="#E08C4C",  # точки ободка
    rim="#A9521C",  # линии ободка
    gold="#F2B233",  # искорки, конфетти
)
OL = 5  # толщина внешнего контура


def f(v):
    """Короткая запись числа."""
    return f"{v:.1f}".rstrip("0").rstrip(".")


def g(content, cls=None, transform=None):
    a = f' class="{cls}"' if cls else ""
    a += f' transform="{transform}"' if transform else ""
    return f"<g{a}>{content}</g>"


def limb(d, w=16):
    """Рука или нога: штрих по пути d с контуром."""
    return (
        f'<path d="{d}" fill="none" stroke="{C["line"]}" stroke-width="{w + 2 * OL}" stroke-linecap="round" stroke-linejoin="round"/>'
        f'<path d="{d}" fill="none" stroke="{C["main"]}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>'
    )


def finger(x1, y1, x2, y2, w=14):
    return limb(f"M{f(x1)} {f(y1)} L{f(x2)} {f(y2)}", w)


def mitten(x, y, rot=0, s=1.0):
    """Кулачок-варежка, пальцы смотрят вниз (+y) при rot=0. (x, y) — центр кисти."""
    p = "M-12 -17q-10 22 4 34q8 6 13-3q5 8 13 3q8-5 5-15q8-8 0-18q-18-16-35-1z"
    return (
        f'<path d="{p}" transform="translate({f(x)} {f(y)}) rotate({f(rot)}) scale({f(s)})" '
        f'fill="{C["main"]}" stroke="{C["line"]}" stroke-width="{OL}" stroke-linejoin="round"/>'
    )


def open_hand(x, y, rot=0, s=1.0):
    """Раскрытая ладонь с пятью пальцами, пальцы вверх (−y) при rot=0. (x, y) — центр ладони."""
    fingers = [(-9, -10, -23, -42), (0, -14, -1, -50), (9, -12, 23, -44), (15, -4, 37, -24), (-11, 6, -33, -2)]
    inner = "".join(finger(*fp) for fp in fingers) + f'<ellipse rx="25" ry="21" fill="{C["main"]}"/>'
    return f'<g transform="translate({f(x)} {f(y)}) rotate({f(rot)}) scale({f(s)})">{inner}</g>'


def foot(x, y, rx=36, ry=17, rot=0):
    return (
        f'<ellipse cx="{f(x)}" cy="{f(y)}" rx="{f(rx)}" ry="{f(ry)}" transform="rotate({f(rot)} {f(x)} {f(y)})" '
        f'fill="{C["main"]}" stroke="{C["line"]}" stroke-width="{OL}"/>'
    )


def coin(cx=198, cy=212):
    """Монета вполоборота: торец слева, лицевая сторона смещена вправо.
    Возвращает (svg, (fx, fy)) — центр лицевой стороны для расстановки лица."""
    fx, fy = cx + 22, cy
    n = 32
    dots = "".join(
        f'<circle cx="{f(fx + 145 * math.cos(2 * math.pi * i / n))}" cy="{f(fy + 145 * math.sin(2 * math.pi * i / n))}" r="7.2"/>'
        for i in range(n)
    )
    hx, hy = cx - 50, cy - 84
    svg = (
        f'<circle cx="{f(cx)}" cy="{f(cy)}" r="179" fill="{C["edge"]}" stroke="{C["line"]}" stroke-width="{OL}"/>'
        f'<circle cx="{f(cx + 12)}" cy="{f(cy - 3)}" r="172" fill="{C["band"]}"/>'
        f'<circle cx="{f(fx)}" cy="{f(fy)}" r="160" fill="{C["band"]}" stroke="{C["rim"]}" stroke-width="3"/>'
        f'<g fill="{C["dot"]}" stroke="{C["rim"]}" stroke-width="2.4">{dots}</g>'
        f'<circle cx="{f(fx)}" cy="{f(fy)}" r="130" fill="{C["main"]}" stroke="{C["rim"]}" stroke-width="5"/>'
        f'<ellipse cx="{f(hx)}" cy="{f(hy)}" rx="24" ry="11" transform="rotate(-35 {f(hx)} {f(hy)})" fill="{C["light"]}" opacity=".9"/>'
    )
    return svg, (fx, fy)


def eye(cx, cy, rx=32, ry=37, look=(-9, 4), pupil=0.86, catch=True):
    """Открытый глаз: белок с контуром, крупный зрачок со сдвигом look, блик."""
    px, py = cx + look[0], cy + look[1]
    s = (
        f'<ellipse cx="{f(cx)}" cy="{f(cy)}" rx="{f(rx)}" ry="{f(ry)}" fill="{C["white"]}" stroke="{C["ink"]}" stroke-width="3"/>'
        f'<ellipse cx="{f(px)}" cy="{f(py)}" rx="{f(rx * pupil)}" ry="{f(ry * 0.92)}" fill="{C["ink"]}"/>'
    )
    if catch:
        s += f'<circle cx="{f(px + 4)}" cy="{f(py - 12)}" r="7.5" fill="#fff"/>'
    return s


def happy_eye(cx, cy, w=50, h=24, sw=8):
    """Закрытый от радости глаз — дуга «^»."""
    return (
        f'<path d="M{f(cx - w / 2)} {f(cy + h / 3)} Q{f(cx)} {f(cy - h)} {f(cx + w / 2)} {f(cy + h / 3)}" '
        f'fill="none" stroke="{C["ink"]}" stroke-width="{sw}" stroke-linecap="round"/>'
    )


def stroke(d, w=8):
    """Бровь, нос, ямочка, сомкнутый рот — линия цвета ink."""
    return f'<path d="{d}" fill="none" stroke="{C["ink"]}" stroke-width="{f(w)}" stroke-linecap="round" stroke-linejoin="round"/>'


def nose(cx, cy):
    return stroke(f"M{f(cx - 12)} {f(cy + 4)} Q{f(cx)} {f(cy - 7)} {f(cx + 12)} {f(cy + 3)}", 4)


def mouth(pid, d, tongue=None, teeth=None):
    """Открытый рот по замкнутому пути d (тёмная заливка).
    tongue=(cx, cy, rx, ry) — язык, обрезается по рту.
    teeth=svg-фрагмент (например, белые прямоугольники) — тоже обрезается по рту."""
    cid = f"{pid}-mouth"
    s = f'<clipPath id="{cid}"><path d="{d}"/></clipPath>'
    s += f'<path d="{d}" fill="{C["ink"]}" stroke="{C["ink"]}" stroke-width="3" stroke-linejoin="round"/>'
    if teeth:
        s += f'<g clip-path="url(#{cid})">{teeth}</g>'
    if tongue:
        tx, ty, trx, tr_y = tongue
        s += f'<ellipse cx="{f(tx)}" cy="{f(ty)}" rx="{f(trx)}" ry="{f(tr_y)}" fill="{C["tongue"]}" clip-path="url(#{cid})"/>'
    return s


def sparkle(x, y, s=1.0, color=None):
    """Четырёхлучевая искорка."""
    c = color or C["gold"]
    return (
        f'<path d="M0-16Q2-2 16 0Q2 2 0 16Q-2 2-16 0Q-2-2 0-16z" transform="translate({f(x)} {f(y)}) scale({f(s)})" fill="{c}"/>'
    )


def confetti(x, y, w=14, h=7, rot=0, color=None):
    c = color or C["gold"]
    return (
        f'<rect x="{f(x - w / 2)}" y="{f(y - h / 2)}" width="{f(w)}" height="{f(h)}" rx="2" '
        f'transform="rotate({f(rot)} {f(x)} {f(y)})" fill="{c}"/>'
    )


def document(title, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><title>{title}</title>{body}</svg>\n'
