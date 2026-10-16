"""Builds the `trazo` wheel from tools/lite-python/trazo (no setuptools: a wheel is a zip with a little metadata).

    python3 make_wheel.py <package dir> <output dir>      prints the wheel's file name
"""
import base64
import hashlib
import io
import os
import sys
import zipfile

NAME = "trazo"
VERSION = "0.2.0"
STAMP = (2020, 1, 1, 0, 0, 0)  # fixed, so the same source always gives the same wheel


def main(package_dir, out_dir):
    dist_info = "%s-%s.dist-info" % (NAME, VERSION)
    files = {}
    for root, _, names in sorted(os.walk(package_dir)):
        for name in sorted(names):
            if name.endswith(".pyc") or "__pycache__" in root:
                continue
            full = os.path.join(root, name)
            rel = os.path.join(NAME, os.path.relpath(full, package_dir)).replace(os.sep, "/")
            with open(full, "rb") as f:
                files[rel] = f.read()
    files[dist_info + "/METADATA"] = (
        "Metadata-Version: 2.1\nName: %s\nVersion: %s\nSummary: Talk to the Trazo canvas from a notebook\n"
        "License: MIT\n" % (NAME, VERSION)
    ).encode()
    files[dist_info + "/WHEEL"] = b"Wheel-Version: 1.0\nGenerator: trazo-make-wheel\nRoot-Is-Purelib: true\nTag: py3-none-any\n"
    record = io.StringIO()
    for path, data in files.items():
        digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
        record.write("%s,sha256=%s,%d\n" % (path, digest, len(data)))
    record.write("%s/RECORD,,\n" % dist_info)
    files[dist_info + "/RECORD"] = record.getvalue().encode()

    os.makedirs(out_dir, exist_ok=True)
    wheel = "%s-%s-py3-none-any.whl" % (NAME, VERSION)
    with zipfile.ZipFile(os.path.join(out_dir, wheel), "w", zipfile.ZIP_DEFLATED) as z:
        for path, data in files.items():
            info = zipfile.ZipInfo(path, STAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, data)
    print(wheel)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
