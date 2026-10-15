"""Builds tails-preview.html (all three options inline, so currentColor takes each row's colour)."""
opts = [("A · SWEEP", "tail-a.svg", "the last X's leg sweeps into a tail under BOX"),
        ("B · CURL", "tail-b.svg", "the O of BOX is a curled tail, like the sleeping fox"),
        ("C · TRAIL", "tail-c.svg", "a tail streams back from the F: the word runs like a fox")]
svgs = {f: open(f).read().split("?>")[-1] for _, f, _ in opts}
def cell(f, w, cls=""):
    return f'<div class="mark {cls}" style="width:{w}px">{svgs[f]}</div>'
rows = []
for bg, fg, lab in (("#1b1b1d", "#f25a1d", "#9a948a"), ("#f4ede0", "#141416", "#6d675e")):
    for name, f, note in opts:
        rows.append(f'<div class="row" style="background:{bg};color:{fg}"><div class="lab" style="color:{lab}">{name}<br><span>{note}</span></div>{cell(f, 760)}</div>')
small = "".join(
    f'<div class="sm" style="background:{bg};color:{fg}"><div class="lab" style="color:{lab}">{name}</div>{cell(f, 80)}{cell(f, 160)}</div>'
    for name, f, _ in opts for bg, fg, lab in (("#1b1b1d", "#fbeedb", "#9a948a"), ("#f4ede0", "#141416", "#6d675e")))
html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{{font-family:JBM;font-weight:500;src:url(../../../src/renderer/src/assets/fonts/jetbrains-mono-latin-500-normal.woff2)}}
html,body{{margin:0}} body{{width:1400px;font:500 15px/1.4 JBM,monospace}}
.row{{height:230px;display:flex;align-items:center;gap:40px;padding:0 50px}}
.lab{{width:300px;flex:none;letter-spacing:.12em}} .lab span{{letter-spacing:0;font-size:13px}}
.mark svg{{width:100%;height:auto;display:block}}
.smalls{{display:grid;grid-template-columns:1fr 1fr}}
.sm{{height:110px;display:flex;align-items:center;gap:36px;padding:0 50px}} .sm .lab{{width:130px}}
</style></head><body>{''.join(rows)}<div class="smalls">{small}</div></body></html>"""
open("tails-preview.html", "w").write(html)
print("ok")
