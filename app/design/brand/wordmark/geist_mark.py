"""FoxBox wordmark from Geist (OFL, the brand font), outlined to paths, with one custom touch: a joined "fo"
(the f's crossbar, or the F's middle arm, runs on into the o).

  uv run --no-project --with fonttools --with uharfbuzz python geist_mark.py <geist-variable.ttf>
  → foxbox-lower.svg, foxbox-title.svg, foxbox-caps.svg (white, warming into soft orange at the baseline)
  → foxbox-voice-lockup.svg: the chosen lowercase foxbox + "VOICE · BETA" (VOICE in the aurora accent)

Wordmark: weight 650, tracking −3 % of the em; kerning from the font (HarfBuzz).
"""
import sys
import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

FONT = sys.argv[1]
WGHT = 650
TRACK = -0.03
tt = TTFont(FONT)
upem = tt["head"].unitsPerEm
order = tt.getGlyphOrder()
hbface = hb.Face(hb.Blob.from_file_path(FONT))
_cache = {}


def at(wght):
    """(HarfBuzz font, glyph set) at a weight."""
    if wght not in _cache:
        f = hb.Font(hbface)
        f.set_variations({"wght": wght})
        _cache[wght] = (f, tt.getGlyphSet(location={"wght": wght}))
    return _cache[wght]


def shape(text, wght=WGHT, track=TRACK):
    font, _ = at(wght)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True, "liga": False})
    x, out = 0, []
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        out.append((order[info.codepoint], x + pos.x_offset))
        x += pos.x_advance + track * upem
    return out, x - track * upem


def outline(name, dx, wght=WGHT, scale=1.0, ox=0.0):
    _, glyphs = at(wght)
    m = (scale, 0, 0, -scale, ox + dx * scale, 0)  # y up → SVG y down; baseline at y = 0
    pen, bp = SVGPathPen(glyphs), BoundsPen(glyphs)
    glyphs[name].draw(TransformPen(pen, m))
    glyphs[name].draw(TransformPen(bp, m))
    return pen.getCommands(), bp.bounds


def crossbar(name, dx, y_lo, y_hi):
    """The rightmost ink of glyph `name` between font-unit heights y_lo..y_hi: (right x, top y, bottom y) in SVG."""
    _, glyphs = at(WGHT)
    pts = []

    class P:
        def moveTo(self, p): pts.append(p)
        def lineTo(self, p): pts.append(p)
        def curveTo(self, *ps): pts.extend(ps)
        def qCurveTo(self, *ps): pts.extend(ps)
        def closePath(self): pass
        def endPath(self): pass
        def addComponent(self, g, t): glyphs[g].draw(TransformPen(self, t))

    glyphs[name].draw(P())
    band = [(x, y) for x, y in pts if y_lo <= y <= y_hi]
    right = max(x for x, _ in band)
    ys = [y for x, y in band if x >= right - 1]
    return dx + right, -max(ys), -min(ys)


def union(a, b):
    if not b:
        return a
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])) if a else b


def mark(text, join):
    """The wordmark's paths and ink bounds."""
    runs, _ = shape(text)
    paths, box = [], None
    for name, dx in runs:
        d, b = outline(name, dx)
        box = union(box, b)
        paths.append(d)
    # The joined fo: carry the f/F's bar on to the o, overlapping it a little so the two fill as one shape.
    (fn, fx), (on, ox) = runs[0], runs[1]
    bx, by0, by1 = crossbar(fn, fx, *join)
    _, ob = outline(on, ox)
    paths.append(f"M{bx - 2:.1f} {by0:.1f}H{ob[0] + 14:.1f}V{by1:.1f}H{bx - 2:.1f}Z")
    return paths, box


def label(text, x, wght, track, cap):
    """Caps `text` with its cap height `cap` (units), starting at x on the baseline: (paths, bounds, right edge)."""
    scale = cap / tt["OS/2"].sCapHeight
    runs, adv = shape(text, wght, track)
    paths, box = [], None
    for name, dx in runs:
        d, b = outline(name, dx, wght, scale, x)
        box = union(box, b)
        if d:
            paths.append(d)
    return paths, box, x + adv * scale


GRAD = ('<linearGradient id="fbg" gradientUnits="userSpaceOnUse" x1="0" y1="{top:.0f}" x2="0" y2="0">'
        '<stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="#fff8f2"/>'
        '<stop offset="1" stop-color="#ffc49a"/></linearGradient>')


def svg(groups, box, label_, pad=4):
    x0, y0, x1, y1 = box
    w, h = x1 - x0 + 2 * pad, y1 - y0 + 2 * pad
    body = []
    for fill, paths in groups:
        body.append(f'  <g fill="{fill}">\n' + "\n".join(f'    <path d="{d}"/>' for d in paths) + "\n  </g>")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0 - pad:.0f} {y0 - pad:.0f} {w:.0f} {h:.0f}" '
            f'role="img" aria-label="{label_[0]}">\n  <title>{label_[0]}</title>\n  <!-- {label_[1]} -->\n'
            f'  <defs>{GRAD.format(top=y0)}</defs>\n' + "\n".join(body) + "\n</svg>\n"), w / h


NOTE = f"Geist {WGHT} (OFL), tracking {TRACK:+.0%}, outlined; the joined fo is ours. White warming into soft orange."
for fname, text, join in (
    ("foxbox-lower.svg", "foxbox", (430, 545)),  # the f crossbar sits just under the x-height
    ("foxbox-title.svg", "FoxBox", (300, 420)),  # the F's middle arm, near half the cap height
    ("foxbox-caps.svg", "FOXBOX", (300, 420)),
):
    paths, box = mark(text, join)
    s, ratio = svg([("url(#fbg)", paths)], box, ("FoxBox", f"{text}. {NOTE}"))
    open(fname, "w").write(s)
    print(fname, f"{ratio:.2f}:1")

# The FoxBox Voice lockup (the user picked lowercase): foxbox, then VOICE · BETA on the same baseline, its caps as tall
# as the wordmark's x-height, a little open (+6 %). VOICE takes Voice's aurora accent, "· BETA" the pale silver.
paths, box = mark("foxbox", (430, 545))
xh = tt["OS/2"].sxHeight
gap = 0.30 * upem
voice, vb, x = label("VOICE", box[2] + gap, 600, 0.06, xh)
beta, bb, _ = label(" · BETA", x, 600, 0.06, xh)  # the spaces carry their own advance
s, ratio = svg([("url(#fbg)", paths), ("#5ce6cf", voice), ("#9aabc2", beta)], union(union(box, vb), bb),
               ("FoxBox Voice (beta)", f"foxbox + VOICE · BETA. {NOTE} VOICE #5ce6cf, · BETA #9aabc2 (ARCTIC tokens)."))
open("foxbox-voice-lockup.svg", "w").write(s)
print("foxbox-voice-lockup.svg", f"{ratio:.2f}:1")
