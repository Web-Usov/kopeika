"""Ошибка «ой»: чешет затылок у края ободка, смущённая улыбка."""

TITLE = "Копейка смущённо чешет затылок"


def draw(r, pid):
    legs = r.limb("M196 372 L184 440", 18) + r.limb("M294 372 L300 442", 18) + r.foot(163, 460) + r.foot(334, 460, rx=37)
    arm_l = r.limb("M95 280 C70 310 62 335 66 368", 16) + r.mitten(70, 385, rot=-12)
    arm_r = r.limb("M392 232 C440 222 456 170 430 130 C416 108 396 98 376 92", 16)
    hand_r = r.mitten(362, 80, rot=-110, s=1.25)
    coin, _ = r.coin(226, 206)
    face = (
        r.g(r.eye(189, 214, 33, 38, look=(10, -4)), "k-eye")
        + r.g(r.eye(314, 175, 31, 37, look=(10, -4)), "k-eye")
        + r.stroke("M162 176 Q184 150 212 134")
        + r.stroke("M282 110 Q306 112 332 134")
        + r.nose(270, 232)
        + r.mouth(pid, "M238 264 Q272 276 306 246 Q304 298 272 303 Q244 300 238 264 Z", tongue=(272, 296, 22, 10))
        + r.stroke("M232 268 Q234 262 240 260", 4)
        + r.stroke("M304 242 Q310 244 311 250", 4)
    )
    fig = (
        r.g(legs, "k-legs")
        + r.g(arm_l, "k-arm-left")
        + r.g(arm_r, "k-arm-right")
        + r.g(r.g(coin, "k-coin") + r.g(face, "k-face"), "k-body")
        + r.g(hand_r, "k-hand-chin")
    )
    return r.g(fig, transform="rotate(-6 248 470)")
