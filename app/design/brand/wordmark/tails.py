"""FOXBOX wordmark, fox-tail options: python3 tails.py  → tail-a.svg, tail-b.svg, tail-c.svg (currentColor).

Letters: extended geometric caps on a 100-unit cap height (verticals 24, horizontals 19). Each tail is a plump
tapered shape along a centreline (narrow where it leaves the letter, bushiest past the middle, a rounded point), and
its white tip is cut off with a chevron, the way a fox's white tip meets the fur, so it reads in one colour.
"""
import math

F = "M0 0H86V19H24V40H72V58H24V100H0Z"
O = ("M40 0H110A40 40 0 0 1 150 40V60A40 40 0 0 1 110 100H40A40 40 0 0 1 0 60V40A40 40 0 0 1 40 0Z"
     "M44 19H106A20 20 0 0 1 126 39V61A20 20 0 0 1 106 81H44A20 20 0 0 1 24 61V39A20 20 0 0 1 44 19Z")
X = "M0 0H33L124 100H91ZM91 0H124L33 100H0Z"
B = ("M0 0H82A20 20 0 0 1 102 20V34A6 6 0 0 1 96 40A16 16 0 0 1 112 56V76A24 24 0 0 1 88 100H0Z"
     "M24 19H72A6 6 0 0 1 78 25V34A6 6 0 0 1 72 40H24ZM24 58H80A8 8 0 0 1 88 66V73A8 8 0 0 1 80 81H24Z")
XS = {"F": 0, "O1": 90, "X1": 252, "B": 390, "O2": 516, "X2": 678}


def cubic(p):
    def f(t):
        u = 1 - t
        return tuple(u**3 * p[0][i] + 3 * u * u * t * p[1][i] + 3 * u * t * t * p[2][i] + t**3 * p[3][i] for i in (0, 1))
    return f


def profile(base, peak, tip_w, peak_at, cut):
    """Full width along t: base → peak (ease out) → tip_w at the cut → a rounded point at t = 1."""
    def w(t):
        if t <= peak_at:
            return base + (peak - base) * math.sin(t / peak_at * math.pi / 2)
        if t <= cut:
            s = (t - peak_at) / (cut - peak_at)
            return peak + (tip_w - peak) * s * s
        s = (t - cut) / (1 - cut)
        return tip_w * max(0.0, 1 - s * s) ** 0.55
    return w


def tail(curve, width, cut=0.8, chevron=0.035, gap=4.5, n=200):
    """(body, tip) polygons. The cut is a chevron pointing towards the tip, `chevron` deep (in t), `gap` units wide."""
    pts = [curve(i / n) for i in range(n + 1)]
    length = sum(math.dist(pts[i], pts[i + 1]) for i in range(n))
    dt = gap / length
    edges = []
    for i, (x, y) in enumerate(pts):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, n)]
        L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
        nx, ny = -(b[1] - a[1]) / L, (b[0] - a[0]) / L
        h = width(i / n) / 2
        edges.append(((x + nx * h, y + ny * h), (x - nx * h, y - ny * h), (x, y), i / n))

    def at(t):  # interpolated (left, right, centre) at t
        f = t * n
        i = min(int(f), n - 1)
        k = f - i
        lerp = lambda p, q: (p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k)
        return tuple(lerp(edges[i][j], edges[i + 1][j]) for j in range(3))

    fmt = lambda pts_: "M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in pts_) + "Z"
    side_t = cut - chevron  # where the cut meets each edge; its point is on the centreline at `cut`
    body = [e[0] for e in edges if e[3] < side_t] + [at(side_t)[0], at(cut)[2], at(side_t)[1]] + \
           [e[1] for e in reversed(edges) if e[3] < side_t]
    t0 = side_t + dt
    tip = [at(t0)[0]] + [e[0] for e in edges if e[3] > t0] + [e[1] for e in reversed(edges) if e[3] > t0] + \
          [at(t0)[1], at(cut + dt)[2]]
    return fmt(body), fmt(tip)


def svg(paths, box, label):
    x0, y0, w, h = box
    lines = []
    for d, tx, eo in paths:
        attrs = (' fill-rule="evenodd"' if eo else "") + (f' transform="translate({tx} 0)"' if tx else "")
        lines.append(f'  <path{attrs} d="{d}"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0} {y0} {w} {h}" role="img" aria-label="FoxBox" '
            f'fill="currentColor">\n  <title>FoxBox</title>\n  <!-- {label} Colour follows currentColor. -->\n'
            + "\n".join(lines) + "\n</svg>\n")


def letters(skip=()):
    return [(d, XS[k], k in ("O1", "B", "O2")) for k, d in
            (("F", F), ("O1", O), ("X1", X), ("B", B), ("O2", O), ("X2", X)) if k not in skip]


# A · SWEEP: the last X stays whole; from its right foot the tail drops past the baseline and sweeps back under BOX.
a = tail(cubic(((785, 88), (792, 152), (712, 166), (446, 142))), profile(32, 46, 30, 0.5, 0.8))
A = svg(letters() + [(a[0], 0, False), (a[1], 0, False)], (-4, -4, 810, 170),
        "Option A, SWEEP: the last X's leg becomes the tail under BOX.")

# B · CURL: the O of BOX is the tail curled round, as the sleeping fox holds it.
cx, cy, rx, ry = 591, 50, 59, 34


def ring(t):  # clockwise on screen from the top left, a little more than once round; a squarish oval (superellipse
    # n = 3) like the other O
    th = math.radians(232 + 372 * t)
    c, s_ = math.cos(th), math.sin(th)
    se = lambda v: math.copysign(abs(v) ** (2 / 3), v)
    return (cx + rx * se(c), cy + ry * se(s_))


# Thin where it starts, bushy round the right and the bottom; the white tip climbs the left side and tapers onto
# the start, so the ring closes.
b = tail(ring, profile(9, 31, 27, 0.5, 0.8), cut=0.8, chevron=0.022, gap=4.5)
Bsvg = svg(letters(skip=("O2",)) + [(b[0], 0, False), (b[1], 0, False)], (-4, -4, 810, 108),
           "Option B, CURL: the O of BOX is a curled fox tail.")

# C · TRAIL: the word runs like a fox; the tail streams back from the F's stem and lifts behind it.
c = tail(cubic(((12, 84), (-36, 98), (-104, 76), (-156, 22))), profile(20, 50, 34, 0.55, 0.8))
C = svg(letters() + [(c[0], 0, False), (c[1], 0, False)], (-190, -12, 996, 124),
        "Option C, TRAIL: a tail streams back from the F.")

for name, s in (("tail-a.svg", A), ("tail-b.svg", Bsvg), ("tail-c.svg", C)):
    open(name, "w").write(s)
print("ok")
