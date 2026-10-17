"""Тревога «ой-ёй»: брови домиком, стиснутые зубы, кулачки сведены у низа монеты."""

TITLE = "Копейка в тревоге: брови домиком, стиснутые зубы, кулачки сведены"


def draw(r, pid):
    legs = (
        r.limb("M222 380 C220 408 208 430 192 446", 18)
        + r.limb("M303 380 C302 410 314 430 330 446", 18)
        + r.foot(176, 460, rx=38, ry=17, rot=-3)
        + r.foot(346, 460, rx=38, ry=17, rot=3)
    )
    arm_l = r.limb("M154 314 C150 345 175 370 205 364 C232 359 246 348 258 334", 18)
    arm_r = r.limb("M388 314 C390 345 368 370 340 362 C326 358 320 348 320 336", 18)
    hands = (
        r.finger(268, 322, 291, 313, 12)
        + r.finger(322, 328, 297, 313, 12)
    )
    fists = r.mitten(262, 332, -35, 1.0) + r.mitten(326, 340, 35, 1.0)
    coin, _ = r.coin(251, 204)
    teeth = (
        '<rect x="210" y="254" width="146" height="20" fill="#FFF8EE"/>'
        '<rect x="210" y="277" width="146" height="20" fill="#FFF8EE"/>'
        + "".join(f'<path d="M{x} 254V274M{x} 277V297" stroke="#A9521C" stroke-width="2.5"/>' for x in (246, 270, 294, 318))
    )
    def lid(cx, cy, rx):
        return r.stroke(f"M{cx - rx} {cy - 2} A{rx} {rx - 3} 0 0 1 {cx + rx} {cy - 2}", 6)

    face = (
        r.g(r.eye(211, 214, 33, 30, look=(12, -4)) + lid(211, 214, 33), "k-eye")
        + r.g(r.eye(336, 192, 31, 29, look=(10, -5)) + lid(336, 192, 31), "k-eye")
        + r.stroke("M182 174 Q208 172 230 142")
        + r.stroke("M300 120 Q322 126 344 138")
        + r.nose(288, 232)
        + r.mouth(
            pid,
            "M218 286 Q222 262 248 258 Q292 262 334 244 Q354 250 350 266 Q340 284 304 290 Q262 296 238 298 Q218 298 218 286Z",
            teeth=teeth,
        )
    )
    body = r.g(r.g(coin, "k-coin") + r.g(face, "k-face"), "k-body")
    return (
        r.g(legs, "k-legs")
        + body
        + r.g(arm_l, "k-arm-left")
        + r.g(arm_r, "k-arm-right")
        + r.g(hands + fists, "k-hands")
    )
