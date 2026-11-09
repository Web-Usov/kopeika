import math
from PIL import Image

W, H = 56, 54
OFF = 2   # top headroom for jump / sparks (render shifts y by OFF)
CX, CY = 28, 26
R = 17.2
RB = 14.9     # inside of outer rim band
RF = 12.5     # face radius
GROUND = 51
BASE = 49    # y of the top boot row (legs shortened by 3)
CFG = dict(beads=(16, 'M'), brow='K', blush='a')

P = {
    'O': (0x68, 0x2E, 0x0D), 'M': (0xD9, 0x7E, 0x3A), 'L': (0xF9, 0xBC, 0x80),
    'D': (0xB4, 0x5A, 0x20), 'E': (0x99, 0x49, 0x17), 'K': (0x31, 0x12, 0x02),
    'W': (0xFF, 0xF8, 0xEE), 'T': (0xD8, 0x6E, 0x3F), 'G': (0xF2, 0xB2, 0x33),
}


def stamp(layer, rows, x0, y0, mirror=False):
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch == '.':
                continue
            x = x0 + i
            if mirror:
                x = W - 1 - x
            layer[(x, y0 + j)] = ch


def mir(layer):
    return {(W - 1 - x, y): c for (x, y), c in layer.items()}


def shift(layer, dx, dy):
    return {(x + dx, y + dy): c for (x, y), c in layer.items()}


def outline(layer, col='O', diag=False):
    out = dict(layer)
    ds = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    if diag:
        ds += [(1, 1), (-1, 1), (1, -1), (-1, -1)]
    for (x, y) in layer:
        for dx, dy in ds:
            p = (x + dx, y + dy)
            if p not in layer:
                out[p] = col
    return out


def over(*layers):
    r = {}
    for l in layers:
        r.update(l)
    return r


def line(p, q):
    (x0, y0), (x1, y1) = p, q
    n = max(abs(x1 - x0), abs(y1 - y0)) or 1
    return [(round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n)) for i in range(n + 1)]


def thick(points, c):
    d = {}
    for (x, y) in points:
        for dx in (0, 1):
            for dy in (0, 1):
                d[(x + dx, y + dy)] = c
    return d


def dist(x, y, dy=0):
    return math.hypot(x + 0.5 - CX, y + 0.5 - CY - dy)


# ---- bead ring (n beads, mirror-symmetric) ----
def make_beads(n):
    q = n // 4
    step = 90.0 / q
    B = set()
    for k in range(q):
        a = math.radians(step / 2 + step * k)
        dx, dy = 13.7 * math.cos(a), 13.7 * math.sin(a)
        for sx in (1, -1):
            for sy in (1, -1):
                B.add((math.floor(CX + sx * dx), math.floor(CY + sy * dy)))
    return B


def coin_fill(back=False):
    BEADS = make_beads(CFG['beads'][0])
    d = {}
    for y in range(H):
        for x in range(W):
            if dist(x, y, 2) <= R:
                d[(x, y)] = 'E'
    for y in range(H):
        for x in range(W):
            r = dist(x, y)
            if r > R:
                continue
            dx, dy = x + 0.5 - CX, y + 0.5 - CY
            if r > RB:
                if dx + dy < -11:
                    c = 'L'
                elif dx + dy > 11:
                    c = 'D'
                else:
                    c = 'M'
            elif r > RF:
                c = CFG['beads'][1] if (x, y) in BEADS else 'E'
            else:
                c = 'M'
            d[(x, y)] = c
    if back:
        stamp(d, ['....LL....', '....LL....', '..L.LL.L..', '...LLLL...', 'LLLLDDLLLL',
                  'LLLLDDLLLL', '...LLLL...', '..L.LL.L..', '....LL....', '....LL....'], CX - 5, CY - 5)
    return d


# ---- face parts ----
EYE = ['.WWWW.', 'WWWWWW', 'WWWWWW', 'WWWWWW', 'WWWWWW', 'WWWWWW', '.WWWW.']


def eye(ox=0, oy=0, pupil=True, big=False):
    e = {}
    stamp(e, EYE, 0, 0)
    if pupil:
        px, py = 1 + ox, 2 + oy
        for j in range(4):
            for i in range(3):
                if not ((i, j) in ((0, 0), (2, 0), (0, 3), (2, 3)) and big is False and False):
                    e[(px + i, py + j)] = 'K'
        e[(px + 2, py)] = 'W'      # highlight
        for k in [(px, py), (px, py + 3), (px + 2, py + 3)]:
            pass
    return outline(e, 'E')


def small_pupil_eye(ox=0, oy=0):
    e = {}
    stamp(e, EYE, 0, 0)
    px, py = 2 + ox, 3 + oy
    for j in range(2):
        for i in range(2):
            e[(px + i, py + j)] = 'K'
    return outline(e, 'E')


LX, RX, EY0 = 19, 31, 21     # left eye x, right eye x (mirrored by construction: 19..24 / 31..36), top y

MOUTH_OPEN = ['KKKKKKKK', '.KKKKKK.', '.KTTTTK.', '..KKKK..']
MOUTH_BIG = ['KKKKKKKKKK', '.KKKKKKKK.', '.KTTTTTTK.', '..KTTTTK..', '...KKKK...']
MOUTH_SMILE = ['K......K', '.KKKKKK.']
MOUTH_O = ['.KK.', 'KKKK', 'KTTK', '.KK.']
MOUTH_WAVY = ['.KK..KK.', 'K..KK..K']
MOUTH_HMM = ['.....KK', 'KKKKK..']
EYE_CALM = ['K....K', '.KKKK.']
EYE_HAPPY = ['.KKKK.', 'K....K']
EYE_BLINK = ['KKKKKK']


def blush(f, y=29):
    m = CFG['blush']
    if m == 'none':
        return
    pat = ['.TTT', 'TTTT', '.TT.'] if m == 'a' else ['TTT', 'TTT']
    for r, row in enumerate(pat):
        for c, ch in enumerate(row):
            if ch == 'T':
                f[(17 + c, y + r)] = 'T'
                f[(W - 1 - (17 + c), y + r)] = 'T'


def stampc(f, rows, x, y, col):
    stamp(f, [r.replace('K', col) for r in rows], x, y)


def brow_flat(f, x, y, n=5):
    for i in range(n):
        f[(x + i, y)] = CFG['brow']


def face(kind, ox=0, oy=0):
    f = {}
    B = CFG['brow']
    if kind == 'idle':
        f.update(shift(eye(ox, oy), LX, EY0)); f.update(shift(eye(ox, oy), RX, EY0))
        stamp(f, MOUTH_SMILE, 24, 32)
        blush(f)
    elif kind == 'blink':
        stamp(f, EYE_BLINK, LX, EY0 + 4); stamp(f, EYE_BLINK, RX, EY0 + 4)
        stamp(f, MOUTH_SMILE, 24, 32)
        blush(f)
    elif kind == 'greet':
        f.update(shift(eye(ox, oy), LX, EY0)); f.update(shift(eye(ox, oy), RX, EY0))
        brow_flat(f, LX + 1, EY0 - 4, 4); brow_flat(f, RX + 1, EY0 - 4, 4)
        stamp(f, MOUTH_OPEN, 24, 31)
        blush(f)
    elif kind == 'settled':
        stamp(f, EYE_CALM, LX, EY0 + 3); stamp(f, EYE_CALM, RX, EY0 + 3)
        stamp(f, MOUTH_SMILE, 24, 31)
        blush(f)
    elif kind == 'think':
        f.update(shift(eye(1, -1), LX, EY0)); f.update(shift(eye(1, -1), RX, EY0))
        brow_flat(f, LX + 1, EY0 - 3, 4)
        stampc(f, ['....K', '...K.', '.KK..'][::-1], RX + 1, EY0 - 5, B)
        stamp(f, MOUTH_HMM, 25, 32)
    elif kind == 'worry':
        f.update(shift(small_pupil_eye(-1, 0), LX, EY0 + 1)); f.update(shift(small_pupil_eye(-1, 0), RX, EY0 + 1))
        stampc(f, ['..KK', '.K..', 'K...'], LX, EY0 - 4, B)
        stampc(f, ['KK..', '..K.', '...K'], RX + 2, EY0 - 4, B)
        stamp(f, MOUTH_WAVY, 24, 33)
    elif kind == 'error':
        f.update(shift(small_pupil_eye(0, 0), LX, EY0)); f.update(shift(small_pupil_eye(0, 0), RX, EY0))
        brow_flat(f, LX + 1, EY0 - 4, 4); brow_flat(f, RX + 1, EY0 - 4, 4)
        stamp(f, MOUTH_O, 26, 31)
    elif kind == 'celebrate':
        stamp(f, EYE_HAPPY, LX, EY0 + 2); stamp(f, EYE_HAPPY, RX, EY0 + 2)
        stamp(f, MOUTH_BIG, 23, 30)
        blush(f, 28)
    return f


# ---- limbs ----
def legs(dy=0, air=False, inset=0):
    """Short legs + soft boots (7 px wide, rounded)."""
    top = 40 + dy
    base = BASE - 2 + dy if air else BASE
    one = {}
    for y in range(top, base):
        for x in (20, 21, 22):
            one[(x, y)] = 'M'
        one[(22, y)] = 'D'
    # boot: row base-1 narrower, base wide, base+1 shade
    for x in range(19, 24):
        one[(x, base)] = 'M'
    for x in range(18, 25):
        one[(x, base + 1)] = 'M'
    for x in range(18, 25):
        one[(x, base + 2)] = 'D'
    one[(19, base)] = 'L'; one[(20, base)] = 'L'      # toe highlight
    one.pop((18, base + 2), None); one.pop((24, base + 2), None)
    one = {(x, y): c for (x, y), c in one.items() if y <= base + 2}
    both = over(shift(one, inset, 0), mir(shift(one, inset, 0)))
    return outline(both)


def hand_open(x, y):
    h = {}
    stamp(h, ['L.L.L', 'LLLLL', 'LLLLL', 'LLLLL', '.LLL.'], x, y)
    stamp(h, ['.DDD.'], x, y + 5)
    return h


def hand_round(x, y):
    h = {}
    stamp(h, ['.LLL.', 'LLLLL', 'LLLLL', '.DDD.'], x, y)
    return h


def hand_fist(x, y):
    h = {}
    stamp(h, ['.LLL.', 'LDLDL', 'LLLLL', '.DDD.'], x, y)
    return h


def line_poly(pts):
    r = []
    for p, q in zip(pts, pts[1:]):
        r += line(p, q)
    return r


def arm_down(dy=0, side='l', dx=0):
    a = thick(line_poly([(10, 32 + dy), (8, 35 + dy), (8, 38 + dy)]), 'M')
    h = hand_round(5, 38 + dy)
    arm = outline(over(a, h))
    if side == 'r':
        arm = mir(arm)
        return shift(arm, -dx, 0)
    return shift(arm, dx, 0)


def arm_in(dy=0, side='l'):
    a = thick(line_poly([(10, 31 + dy), (10, 35 + dy), (12, 38 + dy)]), 'M')
    h = hand_round(11, 38 + dy)
    arm = outline(over(a, h))
    return arm if side == 'l' else mir(arm)


def arm_wave(dy=0, t=0):
    a = thick(line_poly([(43, 31 + dy), (46 + t, 27 + dy), (47 + 2 * t, 21 + dy)]), 'M')
    h = hand_open(45 + 2 * t, 14 + dy)
    return outline(over(a, h))


def arm_up_r(dy=0, t=0):
    a = thick(line_poly([(43, 30 + dy), (47 + t, 24 + dy), (47 + 2 * t, 17 + dy)]), 'M')
    h = hand_fist(45 + 2 * t, 12 + dy)
    return outline(over(a, h))


def arm_cheek_r(dy=0):
    a = thick(line_poly([(44, 36 + dy), (48, 33 + dy), (47, 30 + dy)]), 'M')
    h = hand_open(45, 23 + dy)
    return outline(over(a, h))


def chin_arm(dy=0):
    """Upper arm out to the side, elbow low at the coin's bottom edge, forearm back to a fist
    (light copper) with the index finger pointing up and touching the chin under the mouth."""
    a = thick(line_poly([(44, 31 + dy), (47, 37 + dy), (46, 41 + dy), (36, 40 + dy)]), 'M')
    h = {}
    stamp(h, ['.LD....', '.LD....', '.LD....', 'LLLLLLL', 'LDLDLDL', 'LLLLLLL', '.LLLLLL', '.DDDDD.'], 30, 34 + dy)
    return outline(over(a, h))


def sweat(dy=0):
    d = {}
    stamp(d, ['.W.', '.W.', 'WWW', 'WWW', '.W.'], 44, 6 + dy)
    return outline(d)


def thought(dy=0):
    d = {}
    d.update(outline({(45, 11): 'L', (46, 11): 'L', (45, 12): 'L', (46, 12): 'L'}))
    d.update(outline({(x, y): 'L' for x in (48, 49, 50) for y in (7, 8, 9)}))
    d.update(outline({(52, 2): 'L', (53, 2): 'L', (52, 3): 'L', (53, 3): 'L'}))
    return d


def thought_n(n):
    """Thought bubble from coins: 1..3 pieces, growing away from the head."""
    parts = [{(45, 11): 'L', (46, 11): 'L', (45, 12): 'L', (46, 12): 'L'},
             {(x, y): 'L' for x in (48, 49, 50) for y in (7, 8, 9)},
             {(52, 2): 'L', (53, 2): 'L', (52, 3): 'L', (53, 3): 'L'}]
    d = {}
    for p in parts[:n]:
        d.update(outline(p))
    return d


def sweat_drop(stage, dy=0):
    """stage 1: tiny bead, 2: small drop, 3: full drop."""
    d = {}
    if stage == 1:
        stamp(d, ['W', 'W'], 45, 7 + dy)
    elif stage == 2:
        stamp(d, ['.W.', 'WWW', '.W.'], 44, 6 + dy)
    else:
        stamp(d, ['.W.', '.W.', 'WWW', 'WWW', '.W.'], 44, 6 + dy)
    return outline(d)


def sway(layer, dx, cut=46):
    """Lean the body sideways by dx px; rows from `cut` down (feet) stay put."""
    out = {}
    for (x, y), c in layer.items():
        out[(x + (dx if y < cut else 0), y)] = c
    return out


def spark(x, y, big=True):
    d = {}
    pts = ((0, -2), (0, -1), (0, 0), (0, 1), (0, 2), (-2, 0), (-1, 0), (1, 0), (2, 0)) if big else \
          ((0, -1), (0, 0), (0, 1), (-1, 0), (1, 0))
    for p in pts:
        d[(x + p[0], y + p[1])] = 'G'
    return d


def alarm_marks(dy=0):
    d = {}
    for (x, y) in ((23, 3), (23, 4), (23, 5), (28, 1), (28, 2), (28, 3), (33, 3), (33, 4), (33, 5)):
        d[(x, y + dy)] = 'O'
    return d


def wave_marks(t=0):
    return {(52, 18): 'E', (53, 20): 'E', (52, 22): 'E'}


def resample(layer, sx, sy, ay, cx=CX):
    """Nearest-neighbour scale about (cx, ay) -- squash and stretch."""
    out = {}
    for y in range(-12, H + 12):
        for x in range(0, W):
            src = (int(math.floor(cx + (x + 0.5 - cx) / sx)), int(math.floor(ay + (y + 0.5 - ay) / sy)))
            c = layer.get(src)
            if c:
                out[(x, y)] = c
    return out


YB = CY + R + 2   # coin bottom incl. torec


# ---- compose ----
def compose(pose, dy=0, t=0, blink=False, ox=0, oy=0, air=False, extra=None, sq=None, arms=None, kind=None):
    layers = [legs(dy if air else 0, air)]
    k = kind or {'idle': 'idle', 'wave': 'greet', 'greet': 'greet', 'settled': 'settled', 'think': 'think',
                 'worry': 'worry', 'error': 'error', 'celebrate': 'celebrate'}[pose]
    if blink:
        k = 'blink'
    arms = arms or {'idle': 'down', 'settled': 'down', 'wave': 'wave', 'greet': 'wave', 'think': 'thinkl',
                    'worry': 'in', 'error': 'cheek', 'celebrate': 'up'}[pose]
    if arms == 'down':
        layers += [arm_down(dy, 'l'), arm_down(dy, 'r')]
    elif arms == 'out':
        layers += [arm_down(dy, 'l', dx=-2), arm_down(dy, 'r', dx=-2)]
    elif arms == 'wave':
        layers += [arm_down(dy, 'l'), arm_wave(dy, t)]
    elif arms == 'thinkl':
        layers += [arm_down(dy, 'l')]
    elif arms == 'in':
        layers += [arm_in(dy, 'l'), arm_in(dy, 'r')]
    elif arms == 'cheek':
        layers += [mir(arm_cheek_r(dy)), arm_cheek_r(dy)]
    elif arms == 'up':
        layers += [mir(arm_up_r(dy, t)), arm_up_r(dy, t)]
    coin = coin_fill()
    coin.update(face(k, ox, oy))
    if sq:
        coin = resample(coin, sq[0], sq[1], YB)
    layers.append(outline(shift(coin, 0, dy)))
    if pose == 'think':
        layers.append(chin_arm(dy))
        layers.append(thought(dy))
    if pose == 'worry':
        layers.append(sweat(dy))
    if pose == 'error':
        layers.append(alarm_marks(dy))
    if pose in ('wave', 'greet'):
        layers.append(wave_marks())
    if extra:
        layers.append(extra)
    return over(*layers)


def outer_o(layer):
    res = []
    for (x, y), c in layer.items():
        if c != 'O':
            continue
        if any((x + dx, y + dy) not in layer for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
            res.append((x, y))
    return res


def dark_variant(layer, mode='c'):
    """mode a: outer outline D; b: rim light L on top-left only; c: rim L top-left + D elsewhere;
    old: the h34 light 1px halo."""
    if mode == 'old':
        return over(outline(layer, 'L', diag=True), layer)
    out = dict(layer)
    for (x, y) in outer_o(layer):
        lit = ((x, y - 1) not in layer) or ((x - 1, y) not in layer) or ((x - 1, y - 1) not in layer)
        if mode == 'a':
            out[(x, y)] = 'D'
        elif mode == 'b':
            if lit and ((x + 1, y + 1) in layer or (x, y + 1) in layer or (x + 1, y) in layer):
                out[(x, y)] = 'L'
        elif mode == 'c':
            out[(x, y)] = 'L' if (lit and ((x + 1, y) in layer or (x, y + 1) in layer)) else 'D'
    return out


def render(layer, bg=None):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0) if bg is None else bg + (255,))
    px = im.load()
    for (x, y), c in layer.items():
        y += OFF
        if 0 <= x < W and 0 <= y < H:
            px[x, y] = P[c] + (255,)
    return im


def spin_frame(s, back=False, dy=0):
    coin = coin_fill(back=back)
    if not back:
        coin.update(face('idle'))
    out = {}
    edge = s < 0.2
    hw = R * s
    if s >= 0.999:
        out = coin
    elif edge:
        for y in range(H):
            for x in range(CX - 2, CX + 2):
                if dist(CX, y, 1) <= R:
                    c = [('L', 'M', 'M', 'D'), ('M', 'D', 'D', 'E')][y % 2][x - (CX - 2)]
                    out[(x, y)] = c
    else:
        for y in range(H):
            for x in range(W):
                sx = int(math.floor(CX + (x + 0.5 - CX) / s))
                c = coin.get((sx, y))
                if c and abs(x + 0.5 - CX) <= hw + 0.5:
                    out[(x, y)] = c
    out = shift(out, 0, dy)
    air = dy < -1
    dl = min(1, int(round(3 * (1 - s))))   # boots never merge: a clear gap stays between them
    layers = [legs(dy if air else 0, air, inset=dl)]
    if not edge:
        gap = max(2, int(round(6 * s)))
        left = int(round(CX - hw)) - gap - 5 + 5   # hand left edge target
        dxs = max(0, int(round(CX - hw)) - gap - 5)
        dxs = min(dxs, 14)
        dxs = int(round(CX - hw)) - gap - 5 if s < 0.999 else 0
        layers += [arm_down(dy, 'l', dx=dxs), arm_down(dy, 'r', dx=dxs)]
    layers.append(outline(out))
    if 0.2 <= s < 0.9 or edge:
        n = 2 if edge else 1
        mark = {}
        for k in range(n + 1):
            yy = 16 + k * 10 + (dy // 2)
            for sgn in (-1, 1):
                x0 = CX + sgn * (int(hw) + 5 if not edge else 7)
                for j in range(2):
                    mark[(x0 + (j if sgn > 0 else -j), yy)] = 'E'
        layers.append(mark)
    return over(*layers)
