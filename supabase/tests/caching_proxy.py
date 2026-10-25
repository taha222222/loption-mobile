#!/usr/bin/env python3
"""LOCAL TEST HELPER: a stand-in for a CDN in front of the Storage API.

Forwards every request to the upstream Storage API (a local container),
but caches GET /object/public/... responses forever, the way a CDN may
keep serving a deleted object until its cache entry expires or is purged.
Used by run_phase1c.sh to prove that meal_images_quarantine.py verifies a
removal through the authenticated API and reports a still-cached public
URL instead of trusting it. Listens on 127.0.0.1 only.
Usage: caching_proxy.py <listen-port> <upstream-base-url>
"""
import http.server
import sys
import urllib.error
import urllib.request

UPSTREAM = sys.argv[2].rstrip("/")
CACHE: dict[str, tuple[int, list, bytes]] = {}
HOP = {"connection", "keep-alive", "transfer-encoding", "content-length", "content-encoding"}


class Proxy(http.server.BaseHTTPRequestHandler):
    def _forward(self):
        cacheable = self.command == "GET" and self.path.startswith("/object/public/")
        if cacheable and self.path in CACHE:
            status, headers, body = CACHE[self.path]
            headers = headers + [("X-Test-Cache", "HIT")]
        else:
            n = int(self.headers.get("Content-Length") or 0)
            data = self.rfile.read(n) if n else None
            req = urllib.request.Request(UPSTREAM + self.path, data=data, method=self.command,
                                         headers={k: v for k, v in self.headers.items() if k.lower() not in HOP | {"host"}})
            try:
                with urllib.request.urlopen(req, timeout=60) as r:    # noqa: S310 - local upstream only
                    status, headers, body = r.status, list(r.headers.items()), r.read()
            except urllib.error.HTTPError as e:
                status, headers, body = e.code, list(e.headers.items()), e.read()
            if cacheable and status == 200:
                CACHE[self.path] = (status, headers, body)
            headers = headers + [("X-Test-Cache", "MISS")]
        self.send_response(status)
        for k, v in headers:
            if k.lower() not in HOP:
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = do_POST = do_PUT = do_DELETE = do_HEAD = _forward

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Proxy).serve_forever()
