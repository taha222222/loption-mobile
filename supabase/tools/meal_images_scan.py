#!/usr/bin/env python3
"""Content scan of every object in the public `meal-images` bucket.

MIME metadata alone is not trusted. For every object this tool:
  * downloads the bytes over the bucket's PUBLIC URL (no credentials are
    needed or accepted) into a fresh directory, with index-based file
    names (object names are never used as local paths). The URL is built
    from the object path with EVERY path segment percent-encoded, so names
    containing spaces, '?', '#' or '%' address exactly that object;
  * records SHA-256 and the byte length, and compares the length with the
    inventory;
  * identifies the real format from file signatures (magic bytes) and a
    bounded text sniff (SVG / HTML / XML / text);
  * FULLY DECODES approved formats (JPEG, PNG, WebP) with Pillow, in a
    separate process with CPU-time, memory and pixel-count limits. Nothing
    is rendered or executed: SVG, HTML and other content are only read as
    bytes and are never passed to a renderer or browser;
  * records the response headers the object is SERVED with (Content-Type,
    X-Content-Type-Options, Content-Disposition, Content-Security-Policy,
    Cache-Control), so a staging scan also shows the hosted CDN's headers;
  * reports, per object, every reason it is suspicious:
      fetch_failed, size_mismatch_inventory, over_5_mib,
      declared_type_not_approved, detected_format_not_approved,
      type_mismatch (declared vs detected), extension_mismatch,
      decode_failure, pixel_limit_exceeded, embedded_markup
      (markup/script bytes inside an image), non_staff_uploader
      (provenance flag from the inventory).

Usage (read-only; needs an inventory from
supabase/evidence/meal_images_inventory_readonly.sql):
  meal_images_scan.py --inventory inv.json --base-url URL --download-dir DIR --report report.json
  meal_images_scan.py --inventory inv.json --offline DIR --report report.json
URL is the Storage API root, e.g. https://<project-ref>.supabase.co/storage/v1
(staging scans require CTO approval; they are GET requests on public URLs).
Recommended for staging: fetch first, then run the --offline scan inside a
disposable container started with --network none --read-only --memory 2g.
Exit status: 0 when the scan completed (inspect the report); 2 on usage or
input errors; with --fail-on-suspicious, 1 when any object is suspicious.
"""
import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import urllib.parse
import urllib.request

APPROVED = {"image/jpeg", "image/png", "image/webp"}
MAX_BYTES = 5242880
MAX_DOWNLOAD = 64 * 1024 * 1024        # never pull more than this per object
MAX_PIXELS = 40_000_000                # decompression-bomb guard
PIL_FORMAT = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
EXT_MIME = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


def detect(data: bytes) -> str:
    """Return a MIME-like label from file signatures; never interprets content."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data.startswith(b"BM"):
        return "image/bmp"
    if data[:4] in (b"II*\x00", b"MM\x00*"):
        return "image/tiff"
    if data.startswith(b"\x00\x00\x01\x00"):
        return "image/x-icon"
    if len(data) >= 12 and data[4:8] == b"ftyp":
        brand = data[8:12]
        return "image/avif" if brand in (b"avif", b"avis") else "image/heif-or-mp4"
    if data.startswith(b"%PDF"):
        return "application/pdf"
    if data.startswith(b"PK\x03\x04"):
        return "application/zip"
    if data.startswith(b"\x1f\x8b"):
        return "application/gzip"
    head = data[:4096].lstrip(b"\xef\xbb\xbf \t\r\n").lower()
    if b"<svg" in head:
        return "image/svg+xml"
    if head.startswith(b"<!doctype html") or b"<html" in head or b"<script" in head:
        return "text/html"
    if head.startswith(b"<?xml"):
        return "application/xml"
    if head and all(32 <= c < 127 or c in (9, 10, 13) for c in head[:512]):
        return "text/plain"
    return "application/octet-stream"


def decode_child(path: str, fmt: str) -> None:
    """Runs in a separate, resource-limited process: full decode, no rendering."""
    import resource
    import warnings
    resource.setrlimit(resource.RLIMIT_AS, (1536 * 1024 * 1024, 1536 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
    from PIL import Image
    warnings.simplefilter("error", Image.DecompressionBombWarning)
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    out = {"ok": False}
    try:
        with Image.open(path, formats=[fmt]) as im:
            im.verify()                      # structural check
        with Image.open(path, formats=[fmt]) as im:
            if im.width * im.height > MAX_PIXELS:
                raise ValueError("pixel limit exceeded")
            im.load()                        # full decode of the pixel data
            out = {"ok": True, "format": im.format, "width": im.width, "height": im.height, "mode": im.mode}
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as e:
        out = {"ok": False, "pixel_limit": True, "error": type(e).__name__}
    except Exception as e:                    # noqa: BLE001 - any failure is a decode failure
        out = {"ok": False, "error": f"{type(e).__name__}: {e}"[:300]}
    print(json.dumps(out))


def decode(path: pathlib.Path, mime: str) -> dict:
    try:
        r = subprocess.run([sys.executable, "-I", os.path.abspath(__file__), "--decode-one", str(path), PIL_FORMAT[mime]],
                           capture_output=True, text=True, timeout=60)
        return json.loads(r.stdout.strip().splitlines()[-1]) if r.stdout.strip() else \
            {"ok": False, "error": f"decoder exited {r.returncode}: {r.stderr.strip()[-200:]}"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "decoder timed out"}


def public_url(base_url: str, path: str) -> str:
    """Public URL of a meal-images object; every path segment percent-encoded."""
    return (base_url.rstrip("/") + "/object/public/meal-images/"
            + "/".join(urllib.parse.quote(seg, safe="") for seg in path.split("/")))


SERVED_HEADERS = ("content-type", "x-content-type-options", "content-disposition", "content-security-policy", "cache-control")


def fetch(url: str, dest: pathlib.Path) -> tuple[int, str, dict]:
    """Download over the public URL; also return the response headers that decide how browsers treat it."""
    req = urllib.request.Request(url, headers={"User-Agent": "loption-meal-images-scan"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:          # noqa: S310 - fixed http(s) base URL
            served = {h: r.headers.get(h, "absent") for h in SERVED_HEADERS}
            total = 0
            with dest.open("wb") as fh:
                while chunk := r.read(1 << 16):
                    total += len(chunk)
                    if total > MAX_DOWNLOAD:
                        return r.status, "download exceeded safety cap", served
                    fh.write(chunk)
            return r.status, "", served
    except urllib.error.HTTPError as e:
        return e.code, f"HTTP {e.code}", {}
    except Exception as e:                    # noqa: BLE001
        return 0, f"{type(e).__name__}: {e}"[:200], {}


def main() -> int:
    if len(sys.argv) == 4 and sys.argv[1] == "--decode-one":
        decode_child(sys.argv[2], sys.argv[3])
        return 0
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--inventory", required=True)
    ap.add_argument("--base-url")
    ap.add_argument("--download-dir")
    ap.add_argument("--offline", help="scan files already fetched into this directory")
    ap.add_argument("--report", required=True)
    ap.add_argument("--fail-on-suspicious", action="store_true")
    a = ap.parse_args()
    inv = json.loads(pathlib.Path(a.inventory).read_text())
    objects = inv.get("objects") or []
    if a.offline:
        workdir = pathlib.Path(a.offline)
    elif a.base_url and a.download_dir:
        workdir = pathlib.Path(a.download_dir)
        workdir.mkdir(parents=True, exist_ok=False)            # always a fresh directory
    else:
        print("need --base-url and --download-dir, or --offline", file=sys.stderr)
        return 2

    results = []
    for i, o in enumerate(objects):
        local = workdir / f"object-{i:05d}.bin"
        r = {"id": o.get("id"), "path": o.get("path"), "declared_mimetype": o.get("declared_mimetype"),
             "inventory_size_bytes": o.get("size_bytes"), "uploader_class": o.get("uploader_class"),
             "reasons": []}
        if not a.offline:
            status, err, served = fetch(public_url(a.base_url, o["path"]), local)
            r["served_headers"] = served
            if err:
                r["reasons"].append("fetch_failed")
                r["fetch_error"] = err
        if local.exists() and "fetch_failed" not in r["reasons"]:
            data = local.read_bytes()
            r["sha256"] = hashlib.sha256(data).hexdigest()
            r["bytes"] = len(data)
            r["detected"] = detect(data)
            declared = o.get("declared_mimetype")
            if o.get("size_bytes") is not None and int(o["size_bytes"]) != len(data):
                r["reasons"].append("size_mismatch_inventory")
            if len(data) > MAX_BYTES:
                r["reasons"].append("over_5_mib")
            if declared not in APPROVED:
                r["reasons"].append("declared_type_not_approved")
            if r["detected"] not in APPROVED:
                r["reasons"].append("detected_format_not_approved")
            if declared != r["detected"]:
                r["reasons"].append("type_mismatch")
            if EXT_MIME.get((o.get("extension") or "").lower()) != declared:
                r["reasons"].append("extension_mismatch")
            if r["detected"] in APPROVED:
                lowered = data.lower()
                if any(m in lowered for m in (b"<script", b"<svg", b"<html", b"javascript:")):
                    r["reasons"].append("embedded_markup")
                d = decode(local, r["detected"])
                r["decode"] = d
                if d.get("pixel_limit"):
                    r["reasons"].append("pixel_limit_exceeded")
                elif not d.get("ok"):
                    r["reasons"].append("decode_failure")
            else:
                r["decode"] = {"ok": False, "skipped": "format is not an approved image; not decoded or rendered"}
        elif "fetch_failed" not in r["reasons"]:
            r["reasons"].append("fetch_failed")
        if o.get("flags", {}).get("non_staff_uploader"):
            r["reasons"].append("non_staff_uploader")
        r["status"] = "suspicious" if r["reasons"] else "ok"
        results.append(r)

    summary = {"objects": len(results),
               "ok": sum(r["status"] == "ok" for r in results),
               "suspicious": sum(r["status"] == "suspicious" for r in results),
               "by_reason": {},
               "served_without_nosniff": sum(1 for r in results if r.get("served_headers")
                                             and r["served_headers"].get("x-content-type-options", "absent").lower() != "nosniff")}
    for r in results:
        for reason in r["reasons"]:
            summary["by_reason"][reason] = summary["by_reason"].get(reason, 0) + 1
    pathlib.Path(a.report).write_text(json.dumps({"summary": summary, "results": results}, indent=2, sort_keys=True))
    for r in results:
        print(f"  {r['status']:<10} {r.get('detected', '-'):<24} declared={r.get('declared_mimetype')!s:<24} "
              f"{r.get('bytes', '-')!s:>8}B  {r['path']}  {','.join(r['reasons']) or '-'}")
    print(f"  scan: {summary['objects']} objects, {summary['ok']} ok, {summary['suspicious']} suspicious; "
          f"by reason {json.dumps(summary['by_reason'], sort_keys=True)}; "
          f"served without X-Content-Type-Options: nosniff: {summary['served_without_nosniff']}")
    return 1 if (a.fail_on_suspicious and summary["suspicious"]) else 0


if __name__ == "__main__":
    sys.exit(main())
