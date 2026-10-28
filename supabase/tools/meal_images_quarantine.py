#!/usr/bin/env python3
"""Reversible quarantine of suspicious `meal-images` objects.

NOT part of any migration. Every command that writes requires an explicit
--confirm-* flag; removal additionally requires --approved-by, ONE object
path and that object's SHA-256. Nothing is ever deleted from the public
bucket unless a verified quarantine copy of the exact same bytes exists.
Objects are never removed as a group or because they share a flag: each
removal names one object. Run against staging ONLY with written CTO
approval for that specific step and object. Tested locally by
run_phase1c.sh (S).

Commands
  plan     READ-ONLY. Build a manifest of suspicious objects from a scan
           report (supabase/tools/meal_images_scan.py).
  copy     Create the PRIVATE bucket `meal-images-quarantine` if needed (abort
           if it exists and is public), then for every manifest entry:
           download the public object with the service key, require its
           SHA-256 to equal the scan, upload the bytes as
           application/octet-stream (inert) plus a JSON metadata sidecar,
           download both back and verify. Records copy_verified.
  verify   READ-ONLY. Re-download every quarantine copy and sidecar and check
           SHA-256 against the manifest.
  remove   ONE object (--path) whose SHA-256 the operator states (--sha256):
           the manifest entry must exist and have a verified copy, the
           quarantine copy and the live object must both still have that
           SHA-256, and an entry whose ONLY reason is the provenance flag
           non_staff_uploader additionally needs --allow-provenance-only.
           Deletes through the Storage API and verifies the deletion through
           the AUTHENTICATED Storage API (object must be gone). The public
           URL is checked too and recorded; if a CDN/cache still serves the
           old bytes this is reported as a warning (purge or wait for expiry),
           not as success of the public check. Records who approved and when.
  restore  Copy the quarantined bytes back to `meal-images` with the original
           Content-Type and verify SHA-256 through the authenticated API (and
           record the public URL result). Types or sizes the bucket no longer
           allows are refused by the bucket (415 / 413) and stay in
           quarantine. Any other outcome (target already exists, path not in
           the manifest, copy missing, other HTTP errors) is a FAILURE.
Exit codes: 0 success; 1 failure or refusal; 3 (restore only) nothing
failed but at least one object was refused by the bucket limits.

Credentials: the service-role key is read from the SERVICE_KEY environment
variable and is never printed or written to the manifest.
Usage:
  meal_images_quarantine.py plan    --scan-report R --manifest M
  meal_images_quarantine.py copy    --manifest M --base-url URL --confirm-copy
  meal_images_quarantine.py verify  --manifest M --base-url URL
  meal_images_quarantine.py remove  --manifest M --base-url URL --path P --sha256 H --approved-by NAME --confirm-remove [--allow-provenance-only]
  meal_images_quarantine.py restore --manifest M --base-url URL --path P [--path P ...] --confirm-restore
"""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

PUBLIC = "meal-images"
QUARANTINE = "meal-images-quarantine"


def now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def key() -> str:
    k = os.environ.get("SERVICE_KEY", "")
    if not k:
        raise SystemExit("SERVICE_KEY is not set (service-role key; never printed)")
    return k


def http(method: str, url: str, data: bytes | None = None, headers: dict | None = None, auth: bool = True):
    h = dict(headers or {})
    if auth:
        h["Authorization"] = "Bearer " + key()
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:          # noqa: S310 - fixed base URL
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def quote(path: str) -> str:
    return "/".join(urllib.parse.quote(seg, safe="") for seg in path.split("/"))


def error_code(status: int, body: bytes) -> str:
    """The Storage API's own statusCode from an error body (it often answers HTTP 400 with statusCode 404/413/415)."""
    try:
        return str(json.loads(body).get("statusCode", status))
    except (ValueError, AttributeError):
        return str(status)


def object_gone(base: str, bucket: str, path: str) -> bool:
    """True only if the AUTHENTICATED Storage API says the object does not exist."""
    s, body = http("GET", f"{base}/object/{bucket}/{quote(path)}")
    return s != 200 and error_code(s, body) == "404"


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def load(p: str) -> dict:
    return json.loads(pathlib.Path(p).read_text())


def save(p: str, m: dict) -> None:
    pathlib.Path(p).write_text(json.dumps(m, indent=2, sort_keys=True))


def cmd_plan(a) -> int:
    rep = load(a.scan_report)
    entries = [{"path": r["path"], "id": r["id"], "declared_mimetype": r["declared_mimetype"],
                "bytes": r.get("bytes"), "sha256": r.get("sha256"), "detected": r.get("detected"),
                "reasons": r["reasons"], "quarantine_path": r["path"],
                "sidecar_path": r["path"] + ".quarantine.json",
                # provenance only = the bytes passed every content check; the only
                # concern is who uploaded it. Removal needs an extra explicit flag.
                "provenance_only": r["reasons"] == ["non_staff_uploader"]}
               for r in rep["results"] if r["status"] == "suspicious" and r.get("sha256")]
    skipped = [r["path"] for r in rep["results"] if r["status"] == "suspicious" and not r.get("sha256")]
    save(a.manifest, {"created_at": now(), "source_bucket": PUBLIC, "quarantine_bucket": QUARANTINE,
                      "entries": entries, "not_quarantinable_no_bytes": skipped, "log": []})
    print(f"  plan: {len(entries)} suspicious objects to quarantine; {len(skipped)} without fetched bytes (not quarantinable)")
    return 0


def ensure_private_bucket(base: str) -> None:
    s, body = http("GET", f"{base}/bucket/{QUARANTINE}")
    if s == 200:
        if json.loads(body).get("public"):
            raise SystemExit(f"bucket {QUARANTINE} exists and is PUBLIC: refusing to quarantine into it")
        return
    s, body = http("POST", f"{base}/bucket", json.dumps({"id": QUARANTINE, "name": QUARANTINE, "public": False}).encode(),
                   {"Content-Type": "application/json"})
    if s != 200:
        raise SystemExit(f"could not create private bucket {QUARANTINE}: HTTP {s} {body[:200]!r}")


def cmd_copy(a) -> int:
    m = load(a.manifest)
    ensure_private_bucket(a.base_url)
    failures = 0
    for e in m["entries"]:
        s, data = http("GET", f"{a.base_url}/object/{PUBLIC}/{quote(e['path'])}")
        if s != 200 or sha(data) != e["sha256"]:
            e["copy_verified"] = False
            e["copy_error"] = f"source HTTP {s}" if s != 200 else "source bytes changed since scan"
            failures += 1
            continue
        sidecar = json.dumps({"original_bucket": PUBLIC, "original_path": e["path"], "original_id": e["id"],
                              "original_content_type": e["declared_mimetype"], "bytes": len(data),
                              "sha256": e["sha256"], "detected": e["detected"], "reasons": e["reasons"],
                              "quarantined_at": now()}, indent=2, sort_keys=True).encode()
        for path, body, ctype in ((e["quarantine_path"], data, "application/octet-stream"),
                                  (e["sidecar_path"], sidecar, "application/json")):
            s, resp = http("POST", f"{a.base_url}/object/{QUARANTINE}/{quote(path)}", body, {"Content-Type": ctype})
            if s != 200:
                s2, existing = http("GET", f"{a.base_url}/object/{QUARANTINE}/{quote(path)}")
                if not (s2 == 200 and sha(existing) == sha(body)):        # idempotent re-run
                    e["copy_verified"] = False
                    e["copy_error"] = f"upload {path}: HTTP {s} {resp[:120]!r}"
                    break
        else:
            s1, back = http("GET", f"{a.base_url}/object/{QUARANTINE}/{quote(e['quarantine_path'])}")
            s2, side = http("GET", f"{a.base_url}/object/{QUARANTINE}/{quote(e['sidecar_path'])}")
            e["copy_verified"] = s1 == 200 and sha(back) == e["sha256"] and s2 == 200 and \
                json.loads(side).get("sha256") == e["sha256"]
            e["copied_at"] = now()
        failures += 0 if e.get("copy_verified") else 1
    m["log"].append({"at": now(), "command": "copy", "failures": failures})
    save(a.manifest, m)
    print(f"  copy: {sum(bool(e.get('copy_verified')) for e in m['entries'])}/{len(m['entries'])} copies verified; {failures} failures")
    return 1 if failures else 0


def cmd_verify(a) -> int:
    m = load(a.manifest)
    bad = 0
    for e in m["entries"]:
        s1, back = http("GET", f"{a.base_url}/object/{QUARANTINE}/{quote(e['quarantine_path'])}")
        s2, side = http("GET", f"{a.base_url}/object/{QUARANTINE}/{quote(e['sidecar_path'])}")
        ok = s1 == 200 and sha(back) == e["sha256"] and s2 == 200 and json.loads(side).get("sha256") == e["sha256"]
        bad += 0 if ok else 1
    print(f"  verify: {len(m['entries']) - bad}/{len(m['entries'])} quarantine copies match the manifest")
    return 1 if bad else 0


def cmd_remove(a) -> int:
    m = load(a.manifest)
    matches = [e for e in m["entries"] if e["path"] == a.path]
    result = {"at": now(), "command": "remove", "path": a.path, "approved_by": a.approved_by}

    def refuse(reason: str, e: dict | None = None) -> int:
        if e is not None:
            e["remove_refused"] = reason
        result["refused"] = reason
        m["log"].append(result)
        save(a.manifest, m)
        print(f"  remove: REFUSED {a.path}: {reason}")
        return 1

    if len(matches) != 1:
        return refuse("path is not a (single) entry of the quarantine manifest")
    e = matches[0]
    if e.get("removed_from_public_at"):
        return refuse("already removed", e)
    if a.sha256 != e["sha256"]:
        return refuse("--sha256 does not match the scanned SHA-256 of this entry", e)
    if not e.get("copy_verified"):
        return refuse("no verified quarantine copy", e)
    if e.get("provenance_only") and not a.allow_provenance_only:
        return refuse("only reason is the provenance flag non_staff_uploader; needs --allow-provenance-only", e)
    s1, back = http("GET", f"{a.base_url}/object/{QUARANTINE}/{quote(e['quarantine_path'])}")
    s2, cur = http("GET", f"{a.base_url}/object/{PUBLIC}/{quote(e['path'])}")
    if not (s1 == 200 and sha(back) == e["sha256"]):
        return refuse("quarantine copy missing or no longer matches the scanned SHA-256", e)
    if not (s2 == 200 and sha(cur) == e["sha256"]):
        return refuse("public object missing or no longer matches the scanned SHA-256", e)
    s, resp = http("DELETE", f"{a.base_url}/object/{PUBLIC}/{quote(e['path'])}")
    if s != 200:
        return refuse(f"delete failed: HTTP {s} statusCode {error_code(s, resp)}", e)
    if not object_gone(a.base_url, PUBLIC, e["path"]):
        return refuse("delete returned 200 but the authenticated Storage API still returns the object", e)
    pub, pub_body = http("GET", f"{a.base_url}/object/public/{PUBLIC}/{quote(e['path'])}", auth=False)
    e.pop("remove_refused", None)
    e["removed_from_public_at"] = now()
    e["removal_approved_by"] = a.approved_by
    e["removal_verified_via"] = "authenticated Storage API (object not found)"
    e["public_url_after_removal"] = pub
    e["public_url_still_served"] = pub == 200
    result.update(removed=True, public_url_after_removal=pub)
    m["log"].append(result)
    save(a.manifest, m)
    print(f"  remove: {a.path} removed from {PUBLIC} (approved by {a.approved_by}); verified via the authenticated API")
    if pub == 200:
        same = sha(pub_body) == e["sha256"]
        print(f"  remove: WARNING public URL still returns HTTP 200 ({'the removed bytes' if same else 'other bytes'}): "
              "a CDN or cache is serving a copy; purge it or wait for expiry")
    return 0


def cmd_restore(a) -> int:
    m = load(a.manifest)
    by_path = {e["path"]: e for e in m["entries"]}
    results = []
    for path in a.path:
        e = by_path.get(path)
        if e is None:
            results.append((path, "failed", "path is not an entry of the quarantine manifest"))
            continue
        s, data = http("GET", f"{a.base_url}/object/{QUARANTINE}/{quote(e['quarantine_path'])}")
        if s != 200 or sha(data) != e["sha256"]:
            outcome = ("failed", "quarantine copy missing or changed")
        else:
            s, resp = http("POST", f"{a.base_url}/object/{PUBLIC}/{quote(e['path'])}", data,
                           {"Content-Type": e["declared_mimetype"] or "application/octet-stream"})
            code = error_code(s, resp)
            if s == 200:
                g, back = http("GET", f"{a.base_url}/object/{PUBLIC}/{quote(e['path'])}")
                p, _ = http("GET", f"{a.base_url}/object/public/{PUBLIC}/{quote(e['path'])}", auth=False)
                e["restore_public_url_status"] = p
                outcome = (("restored", "sha256 verified via the authenticated API") if g == 200 and sha(back) == e["sha256"]
                           else ("failed", "uploaded, but the stored bytes do not match the SHA-256"))
            elif code in ("413", "415"):
                outcome = ("refused_by_bucket_limits", f"Storage API {code}; copy kept in quarantine")
            elif code == "409" or b"already exists" in resp.lower():
                outcome = ("failed", f"an object already exists at this path (Storage API {code}); not overwritten")
            else:
                outcome = ("failed", f"HTTP {s} statusCode {code}: {resp[:120]!r}")
        e["restore_result"] = outcome[0] + ": " + outcome[1]
        e["restore_attempted_at"] = now()
        results.append((path,) + outcome)
    m["log"].append({"at": now(), "command": "restore", "paths": list(a.path),
                     "results": {p: r for p, r, _ in results}})
    save(a.manifest, m)
    for p, r, d in results:
        print(f"  restore: {p}: {r} ({d})")
    if any(r == "failed" for _, r, _ in results):
        return 1
    return 3 if any(r == "refused_by_bucket_limits" for _, r, _ in results) else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan"); p.add_argument("--scan-report", required=True); p.add_argument("--manifest", required=True)
    for name in ("copy", "verify", "remove", "restore"):
        p = sub.add_parser(name)
        p.add_argument("--manifest", required=True)
        p.add_argument("--base-url", required=True)
        if name == "copy":
            p.add_argument("--confirm-copy", action="store_true", required=True)
        if name == "remove":
            p.add_argument("--path", required=True, help="exactly ONE object path from the manifest")
            p.add_argument("--sha256", required=True, help="the SHA-256 of that object, as in the manifest")
            p.add_argument("--approved-by", required=True)
            p.add_argument("--confirm-remove", action="store_true", required=True)
            p.add_argument("--allow-provenance-only", action="store_true",
                           help="required when the entry's only reason is non_staff_uploader")
        if name == "restore":
            p.add_argument("--path", action="append", required=True)
            p.add_argument("--confirm-restore", action="store_true", required=True)
    a = ap.parse_args()
    if getattr(a, "base_url", None):
        a.base_url = a.base_url.rstrip("/")
    return {"plan": cmd_plan, "copy": cmd_copy, "verify": cmd_verify, "remove": cmd_remove, "restore": cmd_restore}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
