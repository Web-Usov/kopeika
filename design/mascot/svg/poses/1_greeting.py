"""Приветствие: машет правой рукой, открытая улыбка."""

TITLE = "Копейка машет рукой"


def draw(r, pid):
    legs = r.limb("M172 372 L152 446", 18) + r.limb("M272 374 L273 446", 18) + r.foot(130, 460) + r.foot(290, 460, rx=37)
    arm_l = r.limb("M70 276 C46 304 34 330 37 378", 16) + r.mitten(36, 395)
    arm_r = r.limb("M378 268 C404 250 420 226 432 198", 16) + r.g(r.open_hand(447, 186), "k-hand-wave")
    coin, _ = r.coin()
    face = (
        r.g(r.eye(175, 221, 33, 38), "k-eye")
        + r.g(r.eye(287, 198, 31, 37), "k-eye")
        + r.stroke("M140 165 Q158 146 178 154")
        + r.stroke("M258 136 Q282 118 304 136")
        + r.nose(245, 238)
        + r.mouth(pid, "M192 258 Q238 274 286 250 Q282 304 238 309 Q200 306 192 258 Z", tongue=(238, 302, 30, 13))
        + r.stroke("M186 262 Q188 256 194 254", 4)
        + r.stroke("M284 246 Q290 248 291 254", 4)
    )
    return (
        r.g(legs, "k-legs")
        + r.g(arm_l, "k-arm-left")
        + r.g(arm_r, "k-arm-right")
        + r.g(r.g(coin, "k-coin") + r.g(face, "k-face"), "k-body")
    )
