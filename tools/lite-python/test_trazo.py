"""Tests for the conversion code of the `trazo` module (run by vitest; needs no kernel). python3 test_trazo.py"""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import trazo  # noqa: E402


class Fake:
    """Something shaped like a NetworkX graph"""

    def __init__(self, nodes, edges):
        self._n, self._e = nodes, edges
        self.nodes = lambda data=False: self._n
        self.edges = lambda data=False: self._e


class Frame:
    """Something shaped like a pandas DataFrame"""

    def __init__(self, columns, rows):
        self.columns, self._rows = columns, rows

    def iterrows(self):
        for i, row in enumerate(self._rows):
            yield i, dict(zip(self.columns, row))


class Payload(unittest.TestCase):
    def test_networkx_like(self):
        g = Fake([("a", {"label": "Source", "role": "database"}), ("b", {})], [("a", "b", {"label": "reads"})])
        p = trazo.to_payload(g, "My graph")
        self.assertEqual(p["op"], "draw")
        self.assertEqual(p["title"], "My graph")
        self.assertEqual(p["nodes"][0], {"id": "a", "label": "Source", "role": "database"})
        self.assertEqual(p["edges"], [{"from": "a", "to": "b", "label": "reads"}])

    def test_dict(self):
        p = trazo.to_payload({"nodes": [{"id": 1, "label": "One", "details": ["x", "y"]}, 2], "edges": [(1, 2)]})
        self.assertEqual([n["id"] for n in p["nodes"]], ["1", "2"])
        self.assertEqual(p["nodes"][0]["details"], ["x", "y"])
        self.assertEqual(p["edges"][0]["to"], "2")

    def test_dataframe_edges(self):
        f = Frame(["from", "to", "label"], [("a", "b", "x"), ("b", "c", "")])
        p = trazo.to_payload(f)
        self.assertEqual([n["id"] for n in p["nodes"]], ["a", "b", "c"])
        self.assertEqual(p["edges"][0]["label"], "x")
        g = Frame(["src", "dst"], [("a", "b")])
        self.assertEqual(trazo.to_payload(g)["edges"], [{"from": "a", "to": "b", "label": ""}])

    def test_pairs_create_their_nodes(self):
        p = trazo.to_payload([("a", "b"), ("b", "c", "then")])
        self.assertEqual(len(p["nodes"]), 3)
        self.assertEqual(p["edges"][1]["label"], "then")

    def test_refuses_nothing_and_too_much(self):
        with self.assertRaises(ValueError):
            trazo.to_payload({"nodes": []})
        with self.assertRaises(ValueError):
            trazo.to_payload([(i, i + 1) for i in range(trazo.MAX_NODES + 5)])
        with self.assertRaises(ValueError):
            trazo.to_payload(Frame(["only"], [("a",)]))


def poly(*ring):
    return {"type": "Polygon", "coordinates": [[list(p) for p in ring]]}


def feature(geometry, **props):
    return {"type": "Feature", "properties": props, "geometry": geometry}


SQUARE = poly((0, 0), (4, 0), (4, 3), (0, 3), (0, 0))


class Crs:
    def __init__(self, geographic):
        self.is_geographic = geographic


class Geo:
    """Something shaped like a GeoDataFrame: a crs and a __geo_interface__"""

    def __init__(self, features, geographic=True):
        self.crs = Crs(geographic)
        self.__geo_interface__ = {"type": "FeatureCollection", "features": features}


class Maps(unittest.TestCase):
    def test_a_single_geometry_fits_the_width(self):
        p = trazo.to_map_payload(SQUARE, width=500)
        self.assertEqual(p["op"], "map")
        self.assertEqual(len(p["shapes"]), 1)
        shape = p["shapes"][0]
        self.assertEqual(shape["kind"], "polygon")
        xs = [pt[0] for pt in shape["pts"]]
        self.assertAlmostEqual(max(xs), 500 + 24, delta=1)  # padding on both sides
        self.assertEqual(shape["pts"][0], shape["pts"][-1], "the ring is closed")
        # north is up: the larger latitude has the smaller y
        ys = {tuple(pt) for pt in shape["pts"]}
        self.assertLess(min(pt[1] for pt in shape["pts"]), max(pt[1] for pt in shape["pts"]))

    def test_geographic_coordinates_are_drawn_in_web_mercator(self):
        # a degree of latitude is taller near the pole than at the equator
        low = trazo.to_map_payload(poly((0, 0), (1, 0), (1, 1), (0, 1), (0, 0)), width=100)
        high = trazo.to_map_payload(poly((0, 60), (1, 60), (1, 61), (0, 61), (0, 60)), width=100)
        height = lambda p: max(pt[1] for pt in p["shapes"][0]["pts"]) - min(pt[1] for pt in p["shapes"][0]["pts"])
        self.assertGreater(height(high), height(low) * 1.5)

    def test_projected_coordinates_are_not_reprojected(self):
        projected = Geo([feature(poly((0, 0), (200, 0), (200, 100), (0, 100), (0, 0)))], geographic=False)
        p = trazo.to_map_payload(projected, width=400)
        ys = [pt[1] for pt in p["shapes"][0]["pts"]]
        # 200 x 100 metres keeps its 2:1 shape
        self.assertAlmostEqual((max(ys) - min(ys)) * 2, 400, delta=2)

    def test_holes_lines_points_and_collections(self):
        ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
        hole = [[3, 3], [6, 3], [6, 6], [3, 6], [3, 3]]
        collection = {
            "type": "GeometryCollection",
            "geometries": [
                {"type": "Polygon", "coordinates": [ring, hole]},
                {"type": "LineString", "coordinates": [[0, 0], [5, 5], [9, 1]]},
                {"type": "MultiPoint", "coordinates": [[1, 1], [2, 2]]},
            ],
        }
        kinds = sorted(s["kind"] for s in trazo.to_map_payload(collection)["shapes"])
        self.assertEqual(kinds, ["hole", "line", "point", "point", "polygon"])

    def test_simplification_keeps_the_ends_and_respects_the_budget(self):
        wiggle = [[i, math.sin(i / 3.0) * 0.01] for i in range(2000)]
        line = {"type": "LineString", "coordinates": wiggle}
        p = trazo.to_map_payload(line, max_vertices=300)
        pts = p["shapes"][0]["pts"]
        self.assertLessEqual(len(pts), 300)
        self.assertGreaterEqual(len(pts), 2)
        self.assertIn("simplified", p["note"])
        small = trazo.to_map_payload(SQUARE)
        self.assertEqual(small["note"], "")

    def test_numbers_get_classes_and_text_gets_categories(self):
        features = [feature(SQUARE, v=float(i), kind="a" if i % 2 else "b", name="n%d" % i) for i in range(10)]
        numeric = trazo.to_map_payload(Geo(features), color="v")
        self.assertEqual(len(numeric["legend"]), 5)
        self.assertEqual(len({s["fill"] for s in numeric["shapes"]}), 5)
        text = trazo.to_map_payload(Geo(features), color="kind")
        self.assertEqual(sorted(e["label"] for e in text["legend"]), ["a", "b"])
        few = trazo.to_map_payload(Geo([feature(SQUARE, v=1.0), feature(SQUARE, v=2.0)]), color="v")
        self.assertEqual(len(few["legend"]), 2, "as many classes as distinct values when there are few")

    def test_labels_are_written_on_the_biggest_part(self):
        small = poly((0, 0), (1, 0), (1, 1), (0, 1), (0, 0))
        big = poly((5, 5), (9, 5), (9, 9), (5, 9), (5, 5))
        multi = {"type": "MultiPolygon", "coordinates": [small["coordinates"], big["coordinates"]]}
        p = trazo.to_map_payload(Geo([feature(multi, name="Both")]), label="name")
        self.assertEqual([lab["text"] for lab in p["labels"]], ["Both"])
        # the label sits on the big part (on the right and up), not between the two
        shapes = {tuple(map(tuple, s["pts"])) for s in p["shapes"]}
        self.assertEqual(len(shapes), 2)

    def test_refuses_what_it_cannot_draw(self):
        with self.assertRaises(ValueError):
            trazo.to_map_payload({"type": "FeatureCollection", "features": []})
        with self.assertRaises(ValueError):
            trazo.to_map_payload(SQUARE, color="nope")
        with self.assertRaises(ValueError):
            trazo.to_map_payload(Geo([feature(SQUARE) for _ in range(trazo.MAX_FEATURES + 1)]))
        with self.assertRaises(TypeError):
            trazo.to_map_payload(42)

    def test_a_single_point_is_drawn(self):
        p = trazo.to_map_payload({"type": "Point", "coordinates": [3, 4]})
        self.assertEqual(p["shapes"][0]["kind"], "point")
        self.assertGreater(p["width"], 0)


class State(unittest.TestCase):
    def test_canvas_needs_a_copy_from_trazo(self):
        trazo._state.clear()
        with self.assertRaises(RuntimeError) as ctx:
            trazo.canvas()
        self.assertIn("has not sent the canvas", str(ctx.exception))

    def test_state_messages_are_kept(self):
        trazo._on_message({"content": {"data": {"op": "state", "canvas": {"nodes": [1]}, "selected": {"nodes": []}}}})
        self.assertEqual(trazo._state["canvas"], {"nodes": [1]})
        trazo._on_message({"content": {"data": {"op": "other"}}})
        self.assertEqual(trazo._state["canvas"], {"nodes": [1]})


if __name__ == "__main__":
    unittest.main()
