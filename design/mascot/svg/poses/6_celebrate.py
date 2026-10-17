"""Празднование: прыжок, руки вверх, смех с языком, конфетти."""

TITLE = "Копейка прыгает от радости, вокруг конфетти"


def star(x, y, k=1.0):
    import math

    pts = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        d = (19 if i % 2 == 0 else 8.5) * k
        pts.append(f"{x + d * math.cos(a):.1f},{y + d * math.sin(a):.1f}")
    return f'<polygon points="{" ".join(pts)}" fill="#F2B233" stroke="#D99A1F" stroke-width="2" stroke-linejoin="round"/>'


def draw(r, pid):
    C = r.C
    cop, lt, gd = C["main"], C["light"], C["gold"]
    legs = (
        r.limb("M222 370 C216 396 192 398 170 392", 18)
        + r.limb("M300 372 C306 396 298 408 290 414", 18)
        + r.foot(156, 418, rx=30, ry=15, rot=70)
        + r.foot(284, 436, rx=30, ry=15, rot=80)
    )
    arm_l = r.limb("M124 276 C100 250 84 228 72 206", 16) + r.open_hand(62, 190, -32, 1.0)
    arm_r = r.limb("M404 262 C424 236 434 208 440 180", 16) + r.open_hand(446, 160, 20, 1.0)
    coin, _ = r.coin()
    coin = r.g(coin, "k-coin", "translate(93 66) scale(.8)")
    face = (
        r.g(r.happy_eye(220, 238, 54, 28, 8), "k-eye")
        + r.g(r.happy_eye(316, 214, 54, 28, 8), "k-eye")
        + r.stroke("M194 207 Q200 187 226 183", 6)
        + r.stroke("M286 170 Q304 154 322 168", 6)
        + r.nose(272, 246)
        + r.mouth(pid, "M232 258 Q284 272 334 248 Q330 306 284 304 Q244 301 232 258 Z", tongue=(288, 300, 28, 13))
        + r.stroke("M229 261 Q231 254 237 252", 4)
        + r.stroke("M332 244 Q338 246 338 252", 4)
    )
    cf = "".join(
        [
            r.confetti(72, 112, 38, 18, 40, cop),
            r.confetti(163, 54, 38, 20, 60, gd),
            r.confetti(394, 93, 38, 20, -50, gd),
            r.confetti(458, 275, 38, 18, 50, cop),
            r.confetti(45, 347, 38, 18, -50, cop),
            r.confetti(438, 384, 38, 18, -35, cop),
            r.confetti(224, 445, 36, 19, 30, gd),
            r.confetti(374, 435, 38, 18, -45, cop),
            f'<circle cx="354" cy="62" r="8" fill="{cop}"/>',
            f'<circle cx="106" cy="86" r="9" fill="{gd}"/>',
            f'<circle cx="30" cy="264" r="8" fill="{cop}"/>',
            f'<circle cx="480" cy="224" r="9" fill="{gd}"/>',
            f'<circle cx="378" cy="378" r="9" fill="{gd}"/>',
            f'<circle cx="115" cy="344" r="7" fill="{cop}"/>',
            f'<circle cx="189" cy="464" r="7" fill="{cop}"/>',
        ]
    )
    sp = star(67, 298) + star(98, 408) + star(419, 331)
    return (
        r.g(cf, "k-confetti")
        + r.g(sp, "k-sparkles")
        + r.g(legs, "k-legs")
        + r.g(arm_l, "k-arm-left")
        + r.g(arm_r, "k-arm-right")
        + r.g(coin + r.g(face, "k-face"), "k-body")
    )
