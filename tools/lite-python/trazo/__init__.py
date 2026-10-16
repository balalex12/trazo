"""Talk to the Trazo canvas from a notebook.

    import trazo

    trazo.draw(graph)                # draw a NetworkX graph, a DataFrame of edges, or {"nodes": [...], "edges": [...]}
    trazo.map(gdf, color="pop")      # draw a GeoDataFrame (or shapely geometries, or GeoJSON) as a hand-drawn map
    nodes, edges = trazo.canvas()    # the diagram on the canvas, as two pandas tables
    nodes, edges = trazo.selected()  # the same, only for the boxes you selected

It works in the notebook panel inside Trazo, where this module is already installed. The Python runs in your browser
and talks to the canvas through the page; nothing is sent anywhere else.

`canvas()` and `selected()` give the canvas as it was when the previous cell finished (Trazo sends a fresh copy every
time the diagram or the selection changes, and a notebook can only receive messages between cells). They need pandas:
`import pandas as pd` in the cell, so the notebook loads it.
"""

import math

__all__ = ["draw", "map", "canvas", "selected"]
__version__ = "0.3.0"

MAX_NODES = 150  # the canvas draws at most this many boxes (more would be unreadable)

_comm_holder = {}
# the last copy of the canvas Trazo sent: {"canvas": {nodes, edges}, "selected": {nodes, edges}}
_state = {}


def _on_message(msg):
    data = msg["content"]["data"]
    if data.get("op") == "state":
        _state["canvas"] = data.get("canvas")
        _state["selected"] = data.get("selected")


def _comm():
    comm = _comm_holder.get("comm")
    if comm is None:
        # imported here so the conversion code below can be tested without a kernel
        from ipykernel.comm import Comm

        comm = Comm(target_name="trazo", data={"op": "hello"})
        comm.on_msg(_on_message)
        _comm_holder["comm"] = comm
    return comm


# opening the channel when the module is imported lets Trazo send the canvas before the next cell runs
try:
    _comm()
except Exception:  # not in a kernel (a test, a plain Python): draw() and canvas() will say so
    pass


def _text(value):
    return "" if value is None else str(value)


def _node(key, attrs):
    node = {"id": _text(key), "label": _text(attrs.get("label", key))}
    if attrs.get("details") not in (None, ""):
        details = attrs["details"]
        node["details"] = (
            [_text(d) for d in details] if isinstance(details, (list, tuple)) else _text(details)
        )
    if attrs.get("role"):
        node["role"] = _text(attrs["role"])
    return node


def to_payload(graph, title=None):
    """The message the canvas understands, from a graph in any of the supported shapes."""
    nodes, edges = {}, []

    def see(key, attrs=None):
        key = _text(key)
        if key not in nodes:
            nodes[key] = _node(key, attrs or {})
        elif attrs:
            nodes[key].update(_node(key, attrs))

    if isinstance(graph, dict) and "nodes" in graph:
        for item in graph["nodes"]:
            if isinstance(item, dict):
                see(item.get("id", item.get("label")), item)
            else:
                see(item)
        for edge in graph.get("edges", []):
            if isinstance(edge, dict):
                edges.append((edge.get("from"), edge.get("to"), edge.get("label", "")))
            else:
                edges.append((edge[0], edge[1], edge[2] if len(edge) > 2 else ""))
    elif hasattr(graph, "nodes") and hasattr(graph, "edges") and not hasattr(graph, "columns"):
        # a NetworkX graph (or anything shaped like one)
        for key, attrs in graph.nodes(data=True):
            see(key, dict(attrs))
        for a, b, attrs in graph.edges(data=True):
            edges.append((a, b, dict(attrs).get("label", "")))
    elif hasattr(graph, "columns"):
        # a DataFrame of edges: "from" and "to" (or the first two columns), and an optional "label"
        columns = [c for c in graph.columns]
        start, end = ("from", "to") if "from" in columns and "to" in columns else columns[:2]
        if len(columns) < 2:
            raise ValueError("A DataFrame needs at least two columns: where each edge starts and ends.")
        for _, row in graph.iterrows():
            edges.append((row[start], row[end], row["label"] if "label" in columns else ""))
    else:
        for pair in graph:
            edges.append((pair[0], pair[1], pair[2] if len(pair) > 2 else ""))

    for a, b, _ in edges:
        see(a)
        see(b)
    if not nodes:
        raise ValueError("There is nothing to draw: the graph has no nodes.")
    if len(nodes) > MAX_NODES:
        raise ValueError(
            "That graph has too many nodes to draw (%d; the limit is %d)." % (len(nodes), MAX_NODES)
        )
    return {
        "op": "draw",
        "title": _text(title),
        "nodes": list(nodes.values()),
        "edges": [
            {"from": _text(a), "to": _text(b), "label": _text(label)} for a, b, label in edges
        ],
    }


def draw(graph, title=None):
    """Draw a graph on the canvas, below what is already there (Ctrl+Z in Trazo undoes it)."""
    _comm().send(to_payload(graph, title))


# --- maps -------------------------------------------------------------------------------------------------------------
# A GeoDataFrame, shapely geometries or GeoJSON are projected, simplified and sent as plain shapes in pixels; Trazo
# draws them as hand-drawn lines, polygons and dots inside a frame, with a legend. No geopandas import is needed here
# (anything with a `__geo_interface__` works), and nothing is fetched: there is no basemap, only your geometry.

MAX_FEATURES = 1000
_CATEGORY_FILLS = ["#a5d8ff", "#b2f2bb", "#ffec99", "#ffc9c9", "#d0bfff", "#99e9f2", "#ffd8a8", "#fcc2d7"]
_CLASS_FILLS = ["#e7f5ff", "#a5d8ff", "#74c0fc", "#339af0", "#1971c2"]
_OTHER_FILL = "#dee2e6"
_DEFAULT_FILL = "#a5d8ff"


def _geo_features(data):
    """[(geometry dict, properties dict)] from a GeoDataFrame, GeoSeries, shapely geometry, GeoJSON dict or a list of those."""
    if hasattr(data, "__geo_interface__"):
        data = data.__geo_interface__
    if isinstance(data, (list, tuple)):
        out = []
        for item in data:
            out.extend(_geo_features(item))
        return out
    if not isinstance(data, dict):
        raise TypeError("trazo.map() takes a GeoDataFrame, a GeoSeries, shapely geometries or GeoJSON.")
    kind = data.get("type")
    if kind == "FeatureCollection":
        return [(f.get("geometry"), f.get("properties") or {}) for f in data.get("features", []) if f.get("geometry")]
    if kind == "Feature":
        return [(data["geometry"], data.get("properties") or {})] if data.get("geometry") else []
    return [(data, {})]


def _parts(geom, feature, out):
    """Flattens a geometry into (kind, points, feature index): points, lines, polygon rings and their holes."""
    kind, coords = geom.get("type"), geom.get("coordinates")
    if kind == "Point":
        out.append(("point", [coords], feature))
    elif kind == "MultiPoint":
        out.extend(("point", [c], feature) for c in coords)
    elif kind == "LineString":
        out.append(("line", coords, feature))
    elif kind == "MultiLineString":
        out.extend(("line", c, feature) for c in coords)
    elif kind in ("Polygon", "MultiPolygon"):
        for polygon in [coords] if kind == "Polygon" else coords:
            for i, ring in enumerate(polygon):
                out.append(("polygon" if i == 0 else "hole", ring, feature))
    elif kind == "GeometryCollection":
        for g in geom.get("geometries", []):
            _parts(g, feature, out)


def _distance(p, a, b):
    """distance of p from the segment a-b"""
    dx, dy = b[0] - a[0], b[1] - a[1]
    if dx == 0 and dy == 0:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))


def _simplify(points, eps):
    """Douglas-Peucker; the ends are always kept"""
    n = len(points)
    if eps <= 0 or n <= 2:
        return list(points)
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        far, at = 0.0, -1
        for k in range(i + 1, j):
            d = _distance(points[k], points[i], points[j])
            if d > far:
                far, at = d, k
        if far > eps:
            keep[at] = True
            stack.append((i, at))
            stack.append((at, j))
    return [p for p, k in zip(points, keep) if k]


def _classify(props, column):
    """(a fill for each feature, the legend) from a column: five quantile classes for numbers, the most common values otherwise"""
    values = [p.get(column) for p in props]
    known = [v for v in values if v is not None and v == v]
    numeric = bool(known) and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in known)
    if numeric and len(set(known)) > 1:
        ordered = sorted(known)
        last = len(ordered) - 1
        classes = min(5, len(set(known)))
        breaks = [ordered[round(last * i / classes)] for i in range(classes + 1)]
        # as many colours as classes, spread over the scale
        palette = [_CLASS_FILLS[round(i * 4 / (classes - 1))] for i in range(classes)]
        legend = [{"label": "%g – %g" % (breaks[i], breaks[i + 1]), "color": palette[i]} for i in range(classes)]
        fills = []
        for v in values:
            if v is None or v != v:
                fills.append(_OTHER_FILL)
            else:
                cls = 0
                while cls < classes - 1 and v > breaks[cls + 1]:
                    cls += 1
                fills.append(palette[cls])
        return fills, legend
    counts = {}
    for v in values:
        key = "" if v is None else str(v)
        counts[key] = counts.get(key, 0) + 1
    top = [k for k, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[: len(_CATEGORY_FILLS)]]
    fill_of = {k: _CATEGORY_FILLS[i] for i, k in enumerate(top)}
    legend = [{"label": k or "(none)", "color": fill_of[k]} for k in top]
    if len(counts) > len(top):
        legend.append({"label": "other", "color": _OTHER_FILL})
    return [fill_of.get("" if v is None else str(v), _OTHER_FILL) for v in values], legend


def to_map_payload(data, color=None, label=None, title=None, width=900, max_vertices=2500):
    """The message the canvas understands for a map: projected, simplified shapes in pixels."""
    features = _geo_features(data)
    if not features:
        raise ValueError("There is nothing to draw: no geometries.")
    if len(features) > MAX_FEATURES:
        raise ValueError(
            "That has too many features to draw (%d; the limit is %d). Draw a part of it, or dissolve it first." % (len(features), MAX_FEATURES)
        )
    props = [f[1] for f in features]
    for name in (color, label):
        if name is not None and not any(name in p for p in props):
            raise ValueError("There is no column called %r." % name)
    parts = []
    for index, (geom, _) in enumerate(features):
        _parts(geom, index, parts)
    xs = [pt[0] for _, pts, _ in parts for pt in pts]
    ys = [pt[1] for _, pts, _ in parts for pt in pts]
    if not xs:
        raise ValueError("There is nothing to draw: the geometries are empty.")
    crs = getattr(data, "crs", None)
    geographic = bool(crs.is_geographic) if crs is not None and hasattr(crs, "is_geographic") else (
        all(-180 <= x <= 180 for x in xs) and all(-90 <= y <= 90 for y in ys)
    )

    def project(pt):
        if geographic:
            lat = max(-85.0, min(85.0, pt[1]))
            return (math.radians(pt[0]), math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)))
        return (float(pt[0]), float(pt[1]))

    parts = [(kind, [project(p) for p in pts], feature) for kind, pts, feature in parts]
    px = [p[0] for _, pts, _ in parts for p in pts]
    py_ = [p[1] for _, pts, _ in parts for p in pts]
    min_x, max_x, min_y, max_y = min(px), max(px), min(py_), max(py_)
    span_x, span_y = max_x - min_x, max_y - min_y
    pad = 24.0
    if span_x == 0 and span_y == 0:
        scale = 1.0
    else:
        scale = min(width / span_x if span_x else float("inf"), 1200.0 / span_y if span_y else float("inf"))

    def to_px(p):
        return (pad + (p[0] - min_x) * scale, pad + (max_y - p[1]) * scale)

    shapes = [(kind, [to_px(p) for p in pts], feature) for kind, pts, feature in parts]
    # simplify until the drawing is small enough to be drawn and to stay readable
    eps, kept = 0.0, shapes
    for _ in range(14):
        kept = []
        for kind, pts, feature in shapes:
            if kind == "point":
                kept.append((kind, pts, feature))
                continue
            simple = _simplify(pts, eps)
            if kind in ("polygon", "hole") and len(simple) < 4:
                continue  # a ring that shrank to nothing
            if kind == "line" and len(simple) < 2:
                continue
            kept.append((kind, simple, feature))
        if sum(len(pts) for _, pts, _ in kept) <= max_vertices:
            break
        eps = 0.5 if eps == 0 else eps * 1.7
    else:
        raise ValueError("That is too detailed to draw even after simplifying. Simplify the geometries first (gdf.simplify).")
    fills, legend = _classify(props, color) if color is not None else ([_DEFAULT_FILL] * len(features), [])
    out_shapes = []
    for kind, pts, feature in kept:
        shape = {"kind": kind, "pts": [[round(x, 1), round(y, 1)] for x, y in pts]}
        if kind in ("polygon", "point"):
            shape["fill"] = fills[feature]
        out_shapes.append(shape)
    labels = []
    if label is not None and len(features) <= 80:
        best = {}
        for kind, pts, feature in kept:
            xs_, ys_ = [p[0] for p in pts], [p[1] for p in pts]
            size = (max(xs_) - min(xs_)) * (max(ys_) - min(ys_))
            if kind in ("polygon", "point") and (feature not in best or size > best[feature][0]):
                best[feature] = (size, (min(xs_) + max(xs_)) / 2, (min(ys_) + max(ys_)) / 2)
        for feature, (_, x, y) in sorted(best.items()):
            text = props[feature].get(label)
            if text is not None:
                labels.append({"x": round(x, 1), "y": round(y, 1), "text": _text(text)})
    note = "" if eps == 0 else "simplified (%.1f px tolerance)" % eps
    return {
        "op": "map",
        "title": _text(title),
        "width": round(span_x * scale + 2 * pad, 1) if span_x else 2 * pad + 80,
        "height": round(span_y * scale + 2 * pad, 1) if span_y else 2 * pad + 80,
        "shapes": out_shapes,
        "labels": labels,
        "legend": legend,
        "note": note,
    }


def map(data, color=None, label=None, title=None, width=900, max_vertices=2500):  # noqa: A001 (the name is the API)
    """Draw geometries on the canvas as a hand-drawn map, inside a frame, below what is already there.

    data      a GeoDataFrame, a GeoSeries, shapely geometries or GeoJSON
    color     a column to colour by: five classes for numbers, the most common values otherwise (with a legend)
    label     a column to write on each shape (up to 80 shapes)
    title     the name of the frame
    width     the width of the drawing in canvas pixels
    Geographic coordinates (longitude, latitude) are drawn in Web Mercator, projected ones as they are. There is no
    basemap: only your geometry, simplified so that it stays light (max_vertices).
    """
    _comm().send(to_map_payload(data, color, label, title, width, max_vertices))


def _tables(data):
    try:
        import pandas as pd
    except ImportError:
        raise ImportError(
            "canvas() and selected() give pandas tables: put `import pandas as pd` in the cell so the notebook loads it."
        ) from None
    nodes = pd.DataFrame(data.get("nodes", []), columns=["id", "label", "details", "role"])
    edges = pd.DataFrame(data.get("edges", []), columns=["from", "to", "label"])
    return nodes, edges


def _read(key):
    try:
        _comm()
    except Exception:  # not in a kernel: there is no canvas to read, and the message below says why
        pass
    data = _state.get(key)
    if data is None:
        raise RuntimeError(
            "Trazo has not sent the canvas yet. Run this cell again in a moment. This works only in the notebook "
            "panel inside Trazo (menu: Python notebook), not in a notebook opened in its own tab."
        )
    return _tables(data)


def canvas():
    """The whole diagram on the canvas as two tables: boxes (id, label, details, role) and arrows (from, to, label)."""
    return _read("canvas")


def selected():
    """Like `canvas`, for the boxes that are selected on the canvas."""
    return _read("selected")
