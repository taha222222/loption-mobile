// Single-port gateway for the hands-on workflow demo (run_workflow_demo.sh).
// Serves the app's web build and, on the same origin, /auth/v1/* (Auth) and
// /rest/v1/* (PostgREST), so the demo also works behind a port preview or a
// tunnel. The web build is exported with the local URL; this server rewrites
// that one literal in the JavaScript bundle to the page's own origin. Demo
// only: it never changes app code or talks to a hosted project.
// Usage: node demo_gateway.js <port> <authPort> <restPort> <webDir> <builtUrl> [host]
const http = require('http');
const fs = require('fs');
const path = require('path');

const [port, authPort, restPort, webDir, builtUrl, host = '127.0.0.1'] = process.argv.slice(2);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };
const literal = new RegExp(`(["'])${builtUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`, 'g');
const jsCache = new Map();

function proxy(req, res, upstreamPort, target) {
  const headers = { ...req.headers, host: `127.0.0.1:${upstreamPort}` };
  const upstream = http.request({ host: '127.0.0.1', port: upstreamPort, path: target, method: req.method, headers }, (up) => {
    res.writeHead(up.statusCode, up.headers);
    up.pipe(res);
  });
  upstream.on('error', (e) => {
    res.writeHead(502);
    res.end(String(e));
  });
  req.pipe(upstream);
}

http
  .createServer((req, res) => {
    if (req.url.startsWith('/auth/v1/')) return proxy(req, res, authPort, req.url.slice('/auth/v1'.length));
    if (req.url.startsWith('/rest/v1/')) return proxy(req, res, restPort, req.url.slice('/rest/v1'.length));
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(webDir, urlPath);
    if (!file.startsWith(path.resolve(webDir)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(webDir, 'index.html');
    }
    const ext = path.extname(file);
    if (ext === '.js') {
      if (!jsCache.has(file)) jsCache.set(file, fs.readFileSync(file, 'utf8').replace(literal, '(window.location.origin)'));
      res.writeHead(200, { 'content-type': types[ext], 'cache-control': 'no-store' });
      res.end(jsCache.get(file));
      return;
    }
    res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(Number(port), host);
