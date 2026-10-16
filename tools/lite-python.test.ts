import { spawnSync } from "node:child_process";

// The conversion code of the `trazo` Python module has its own unittest file; this runs it with the rest of the tests
// (it needs python3, which the notebook site build needs anyway: skipped without it).
const python = spawnSync("python3", ["-c", "pass"]).status === 0;

(python ? describe : describe.skip)(
  "tools/lite-python (the trazo module)",
  () => {
    it("passes its unittests", () => {
      const r = spawnSync("python3", ["tools/lite-python/test_trazo.py"], {
        encoding: "utf8",
      });
      if (r.status !== 0) {
        throw new Error(r.stderr);
      }
      expect(r.status).toBe(0);
    });

    it("builds a wheel with the module in it", () => {
      const dir = `${process.env.TMPDIR || "/tmp"}/trazo-wheel-test`;
      const r = spawnSync(
        "python3",
        ["tools/lite-python/make_wheel.py", "tools/lite-python/trazo", dir],
        { encoding: "utf8" },
      );
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe("trazo-0.2.0-py3-none-any.whl");
      const list = spawnSync(
        "python3",
        ["-m", "zipfile", "-l", `${dir}/${r.stdout.trim()}`],
        {
          encoding: "utf8",
        },
      );
      expect(list.stdout).toContain("trazo/__init__.py");
      expect(list.stdout).toContain("trazo-0.2.0.dist-info/RECORD");
    });
  },
);
