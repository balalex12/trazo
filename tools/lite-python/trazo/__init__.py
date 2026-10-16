"""Talk to the Trazo canvas from a notebook.

    import trazo

    trazo.draw(graph)                # draw a NetworkX graph, a DataFrame of edges, or {"nodes": [...], "edges": [...]}
    nodes, edges = trazo.canvas()    # the diagram on the canvas, as two pandas tables
    nodes, edges = trazo.selected()  # the same, only for the boxes you selected

It works in the notebook panel inside Trazo, where this module is already installed. The Python runs in your browser
and talks to the canvas through the page; nothing is sent anywhere else.

`canvas()` and `selected()` give the canvas as it was when the previous cell finished (Trazo sends a fresh copy every
time the diagram or the selection changes, and a notebook can only receive messages between cells). They need pandas:
`import pandas as pd` in the cell, so the notebook loads it.
"""

__all__ = ["draw", "canvas", "selected"]
__version__ = "0.2.0"

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
