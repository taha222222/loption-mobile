#!/usr/bin/env python3
"""Offline unit tests for the meal-images tools (no network, no database).

Object names may contain characters that mean something in a URL. Each
path segment must be percent-encoded so a request addresses exactly that
object: ' ' (invalid in a URL), '?' (would start a query and address a
DIFFERENT object), '#' (would start a fragment and be dropped), '%'.
The local Storage API v1.79.30 rejects '#' and '%' in new object keys
(InvalidKey), so those two cannot be exercised end to end; they are
covered here. Exit 1 on any failure.
"""
import pathlib
import sys
import urllib.parse

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))
import meal_images_quarantine as q   # noqa: E402
import meal_images_scan as s         # noqa: E402

cases = {
    "with space.png": "with%20space.png",
    "q?mark.png": "q%3Fmark.png",
    "h#ash.png": "h%23ash.png",
    "pct%41.png": "pct%2541.png",
    "dir/sub dir/x?.png": "dir/sub%20dir/x%3F.png",
    "café.png": "caf%C3%A9.png",
}
fails = 0
for name, enc in cases.items():
    url = s.public_url("http://h/storage/v1/", name)
    want = "http://h/storage/v1/object/public/meal-images/" + enc
    sel = urllib.parse.urlsplit(url)
    ok = (url == want and q.quote(name) == enc and not sel.query and not sel.fragment
          and urllib.parse.unquote(sel.path.split("/meal-images/", 1)[1]) == name)
    fails += not ok
    print(f"  {'PASS' if ok else 'FAIL'} {name!r} -> {url}")
print(f"  tooling unit tests: {len(cases) - fails} pass / {fails} fail")
sys.exit(1 if fails else 0)
