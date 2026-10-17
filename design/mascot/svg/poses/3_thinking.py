"""Задумчивость: взгляд вверх-вправо, рука у подбородка, вторая в бок."""

TITLE = "Копейка задумалась"


def draw(r, pid):
    legs = r.limb("M205 384 L182 450", 18) + r.limb("M304 384 L301 450", 18) + r.foot(163, 463, rx=40) + r.foot(318, 463, rx=38)
    arm_r = r.limb("M392 290 C420 292 440 312 428 334 L400 354", 16) + r.mitten(390, 362, rot=-70, s=1.05)
    coin, _ = r.coin(228, 205)
    face = (
        r.g(r.eye(204, 216, 32, 38, look=(7, -9)), "k-eye")
        + r.g(r.eye(322, 174, 31, 37, look=(7, -9)), "k-eye")
        + r.stroke("M164 160 Q184 134 212 124")
        + r.stroke("M279 122 Q306 104 332 120")
        + r.nose(276, 226)
        + r.stroke("M246 258 Q278 272 304 240", 6)
    )
    arm_l = r.limb("M170 392 C132 392 130 352 160 338 C180 322 198 310 218 302", 16) + r.mitten(238, 300, rot=110, s=1.1) + r.finger(242, 286, 248, 268, 12)
    return (
        r.g(legs, "k-legs")
        + r.g(arm_r, "k-arm-right")
        + r.g(r.g(coin, "k-coin") + r.g(face, "k-face"), "k-body")
        + r.g(arm_l, "k-arm-left k-hand-chin")
    )
