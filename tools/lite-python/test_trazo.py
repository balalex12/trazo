"""Tests for the conversion code of the `trazo` module (run by vitest; needs no kernel). python3 test_trazo.py"""
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
