"""Спокойная радость «все в расчёте»: глаза-дуги, рука у щеки, искорки."""

TITLE = "Копейка радуется: все в расчёте"


def draw(r, pid):
    legs = r.limb("M205 392 L186 448", 18) + r.limb("M282 396 L290 448", 18) + r.foot(160, 464) + r.foot(292, 464, rx=37)
    coin, _ = r.coin(236, 212)
    face = (
        r.stroke("M166 168 Q186 144 208 152", 10)
        + r.stroke("M286 126 Q306 104 328 124", 10)
        + r.happy_eye(206, 224, 66, 32, 10)
        + r.happy_eye(330, 186, 62, 30, 10)
        + r.nose(284, 224)
        + r.mouth(pid, "M222 252 Q276 270 330 230 Q326 296 278 298 Q232 292 222 252 Z", tongue=(278, 298, 34, 16))
    )
    arm = r.limb("M372 356 C400 340 398 306 384 290", 18) + r.mitten(352, 272, rot=-20, s=1.3)
    sparkles = (
        r.sparkle(53, 101, 1.3) + r.sparkle(456, 131, 1.5) + r.sparkle(43, 290, 0.9) + r.sparkle(440, 330, 1.0)
    )
    return (
        r.g(legs, "k-legs")
        + r.g(r.g(coin, "k-coin") + r.g(face, "k-face"), "k-body")
        + r.g(arm, "k-arm-right k-hand-chin")
        + r.g(sparkles, "k-sparkles")
    ).replace('class="k-arm-right k-hand-chin"', 'class="k-arm-right"')
