"""Convert the official ArcGIS Architecture Center Visio toolkit (.vssx) icons to SVG.

Usage: python scripts/visio_to_svg.py <dir with *.vssx> <out dir>

Source: https://architecture.arcgis.com/en/framework/architecture-practices/diagramming-resources.html
License: CC BY 4.0 (c) Esri. Attribution required, see NOTICE.md.
Writes <out>/<set-slug>/<icon-slug>.svg and <out>/index.json
"""
import glob, json, math, os, re, sys, zipfile
import xml.etree.ElementTree as ET

NS = {"v": "http://schemas.microsoft.com/office/visio/2012/main"}
VISIO_COLORS = {0: "#000000", 1: "#ffffff", 2: "#ff0000", 3: "#00ff00", 4: "#0000ff", 5: "#ffff00", 6: "#ff00ff", 7: "#00ffff"}


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def color(v, default):
    if v is None:
        return default
    if v.startswith("#"):
        return v
    try:
        return VISIO_COLORS.get(int(v), default)
    except ValueError:
        return default


def f(v, d=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


def arc_to_cubics(p0, p1, p2, c, d):
    """Visio EllipticalArcTo: arc from p0 to p2 passing through p1; ellipse major axis angle c, ratio d."""
    cs, sn = math.cos(-c), math.sin(-c)

    def fwd(p):  # to circle space
        x, y = p[0] * cs - p[1] * sn, p[0] * sn + p[1] * cs
        return (x, y * d)

    ci, si = math.cos(c), math.sin(c)

    def inv(p):
        x, y = p[0], p[1] / d
        return (x * ci - y * si, x * si + y * ci)

    a, b, e = fwd(p0), fwd(p1), fwd(p2)
    det = 2 * (a[0] * (b[1] - e[1]) + b[0] * (e[1] - a[1]) + e[0] * (a[1] - b[1]))
    if abs(det) < 1e-12:
        return [("L", p2)]
    ux = ((a[0] ** 2 + a[1] ** 2) * (b[1] - e[1]) + (b[0] ** 2 + b[1] ** 2) * (e[1] - a[1]) + (e[0] ** 2 + e[1] ** 2) * (a[1] - b[1])) / det
    uy = ((a[0] ** 2 + a[1] ** 2) * (e[0] - b[0]) + (b[0] ** 2 + b[1] ** 2) * (a[0] - e[0]) + (e[0] ** 2 + e[1] ** 2) * (b[0] - a[0])) / det
    r = math.hypot(a[0] - ux, a[1] - uy)
    ang = lambda p: math.atan2(p[1] - uy, p[0] - ux)
    a0, a1, a2 = ang(a), ang(b), ang(e)
    tau = 2 * math.pi
    ccw = ((a1 - a0) % tau) < ((a2 - a0) % tau)
    sweep = ((a2 - a0) % tau) if ccw else -((a0 - a2) % tau)
    if abs(sweep) < 1e-9:
        sweep = tau if ccw else -tau
    n = max(1, int(math.ceil(abs(sweep) / (math.pi / 2) - 1e-9)))
    delta = sweep / n
    k = 4 / 3 * math.tan(delta / 4)
    out, t = [], a0
    for _ in range(n):
        t2 = t + delta
        p_a = (ux + r * math.cos(t), uy + r * math.sin(t))
        p_b = (ux + r * math.cos(t2), uy + r * math.sin(t2))
        c1 = (p_a[0] - k * r * math.sin(t), p_a[1] + k * r * math.cos(t))
        c2 = (p_b[0] + k * r * math.sin(t2), p_b[1] - k * r * math.cos(t2))
        out.append(("C", inv(c1), inv(c2), inv(p_b)))
        t = t2
    out[-1] = out[-1][:3] + (p2,)
    return out


def shape_cells(sh):
    return {c.get("N"): c.get("V") for c in sh.findall("v:Cell", NS)}


class Conv:
    def __init__(self):
        self.paths = []  # (d, fill, stroke, stroke_width)

    def shape(self, sh, tf):
        """tf: function mapping this shape's local (x, y) to root coordinates (y up)."""
        cells = shape_cells(sh)
        w, h = f(cells.get("Width")), f(cells.get("Height"))
        px, py = f(cells.get("PinX")), f(cells.get("PinY"))
        lx, ly = f(cells.get("LocPinX")), f(cells.get("LocPinY"))
        fx, fy = f(cells.get("FlipX")) == 1, f(cells.get("FlipY")) == 1
        ang = f(cells.get("Angle"))
        ca, sa = math.cos(ang), math.sin(ang)

        def local_to_root(p):
            x, y = p[0] - lx, p[1] - ly
            if fx:
                x = w - p[0] - lx
            if fy:
                y = h - p[1] - ly
            if ang:
                x, y = x * ca - y * sa, x * sa + y * ca
            return tf((x + px, y + py))

        fill_pat = cells.get("FillPattern", "1")
        line_pat = cells.get("LinePattern", "0")
        fill = color(cells.get("FillForegnd"), "#007ac2") if fill_pat != "0" else None
        stroke = color(cells.get("LineColor"), "#000000") if line_pat != "0" else None
        sw = f(cells.get("LineWeight"), 0.01)

        compound = {}
        for sec in sh.findall("v:Section", NS):
            if sec.get("N") != "Geometry":
                continue
            gc = shape_cells(sec)
            if gc.get("NoShow") == "1":
                continue
            d, cur, start = [], (0.0, 0.0), None
            for row in sec.findall("v:Row", NS):
                t, rc = row.get("T"), shape_cells(row)
                X, Y = f(rc.get("X")) * w, f(rc.get("Y")) * h
                if t == "RelMoveTo":
                    d.append(("M", (X, Y))); cur = (X, Y)
                elif t == "RelLineTo":
                    d.append(("L", (X, Y))); cur = (X, Y)
                elif t == "RelCubBezTo":
                    d.append(("C", (f(rc.get("A")) * w, f(rc.get("B")) * h), (f(rc.get("C")) * w, f(rc.get("D")) * h), (X, Y))); cur = (X, Y)
                elif t == "RelQuadBezTo":
                    q = (f(rc.get("A")) * w, f(rc.get("B")) * h)
                    c1 = (cur[0] + 2 / 3 * (q[0] - cur[0]), cur[1] + 2 / 3 * (q[1] - cur[1]))
                    c2 = (X + 2 / 3 * (q[0] - X), Y + 2 / 3 * (q[1] - Y))
                    d.append(("C", c1, c2, (X, Y))); cur = (X, Y)
                elif t == "RelEllipticalArcTo":
                    mid = (f(rc.get("A")) * w, f(rc.get("B")) * h)
                    d.extend(arc_to_cubics(cur, mid, (X, Y), f(rc.get("C")), f(rc.get("D"), 1.0) or 1.0)); cur = (X, Y)
            if not d:
                continue
            segs = []
            for seg in d:
                pts = [local_to_root(p) for p in seg[1:]]
                segs.append((seg[0], pts))
            sec_fill = None if gc.get("NoFill") == "1" else fill
            sec_stroke = None if gc.get("NoLine") == "1" else stroke
            if sec_fill is None and sec_stroke is None:
                continue
            # Geometry sections of one shape form a single compound path (overlaps become holes).
            key = (sec_fill, sec_stroke, sw)
            merged = compound.setdefault(key, [])
            merged.extend(segs)

        for (cf, cs, cw), segs in compound.items():
            self.paths.append((segs, cf, cs, cw))

        sub = sh.find("v:Shapes", NS)
        if sub is not None:
            for child in sub.findall("v:Shape", NS):
                self.shape(child, local_to_root)


def master_to_svg(master_xml):
    root = ET.parse(master_xml).getroot()
    conv = Conv()
    shapes = root.find("v:Shapes", NS).findall("v:Shape", NS)
    if not shapes:
        return None
    # Use the first top-level shape box as the canvas
    cells = shape_cells(shapes[0])
    W, H = f(cells.get("Width")), f(cells.get("Height"))
    px, py = f(cells.get("PinX")), f(cells.get("PinY"))
    lx, ly = f(cells.get("LocPinX")), f(cells.get("LocPinY"))
    ox, oy = px - lx, py - ly
    for s in shapes:
        conv.shape(s, lambda p: (p[0], p[1]))
    if not conv.paths or W <= 0 or H <= 0:
        return None
    S = 100.0 / max(W, H)  # 1 inch -> scaled units

    def P(p):
        return f"{(p[0] - ox) * S:.2f},{(H - (p[1] - oy)) * S:.2f}"

    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W * S:.2f} {H * S:.2f}" width="{W * S:.2f}" height="{H * S:.2f}">']
    for segs, fill, stroke, sw in conv.paths:
        d = ""
        for op, pts in segs:
            d += op + " ".join(P(p) for p in pts) + " "
        attrs = f'd="{d.strip()}" fill-rule="evenodd" fill="{fill or "none"}"'
        if stroke:
            attrs += f' stroke="{stroke}" stroke-width="{max(sw * S, 0.3):.2f}" stroke-linejoin="round"'
        out.append(f"<path {attrs}/>")
    out.append("</svg>")
    return "".join(out), W / H


def main(src, dst):
    index = []
    for vssx in sorted(glob.glob(os.path.join(src, "*.vssx"))):
        set_name = os.path.splitext(os.path.basename(vssx))[0].replace("ArcGIS_", "").replace("_", " ")
        z = zipfile.ZipFile(vssx)
        masters = ET.fromstring(z.read("visio/masters/masters.xml"))
        rels = ET.fromstring(z.read("visio/masters/_rels/masters.xml.rels"))
        target = {r.get("Id"): r.get("Target") for r in rels}
        for m in masters:
            name = m.get("Name") or m.get("NameU")
            rel = m.find("v:Rel", NS)
            rid = rel.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
            tmp = os.path.join(dst, "_tmp.xml")
            os.makedirs(dst, exist_ok=True)
            with open(tmp, "wb") as fh:
                fh.write(z.read("visio/masters/" + target[rid]))
            res = master_to_svg(tmp)
            os.remove(tmp)
            if not res:
                print("skip", set_name, name)
                continue
            svg, aspect = res
            d = os.path.join(dst, slug(set_name))
            os.makedirs(d, exist_ok=True)
            fn = slug(name) + ".svg"
            with open(os.path.join(d, fn), "w", encoding="utf-8") as fh:
                fh.write(svg)
            index.append({"set": set_name, "name": name, "file": f"{slug(set_name)}/{fn}", "aspect": aspect})
    with open(os.path.join(dst, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, indent=1)
    print(len(index), "icons")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
