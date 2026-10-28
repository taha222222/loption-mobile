// Local stand-in for the Supabase API gateway in the end-to-end harness.
// Routes /auth/v1/* to the Auth (GoTrue) container and /rest/v1/* to
// PostgREST, adds CORS for the locally served web build, and serves the
// web build itself (SPA fallback). Local only: binds 127.0.0.1.
// Usage: node gateway.js <gatewayPort> <authPort> <restPort> <webDir> <webPort>
const http = require('http');
const fs = require('fs');
const path = require('path');

const [gatewayPort, authPort, restPort, webDir, webPort] = process.argv.slice(2);

function cors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'authorization,apikey,content-type,prefer,accept,accept-profile,content-profile,range,x-client-info,x-supabase-api-version'
  );
  res.setHeader('Access-Control-Expose-Headers', 'content-range,x-supabase-api-version');
}

http
  .createServer((req, res) => {
    cors(res, req.headers.origin);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    let port;
    let target;
    if (req.url.startsWith('/auth/v1/')) {
      port = authPort;
      target = req.url.slice('/auth/v1'.length);
    } else if (req.url.startsWith('/rest/v1/')) {
      port = restPort;
      target = req.url.slice('/rest/v1'.length);
    } else {
      res.writeHead(404);
      res.end();
      return;
    }
    const headers = { ...req.headers, host: `127.0.0.1:${port}` };
    const upstream = http.request({ host: '127.0.0.1', port, path: target, method: req.method, headers }, (up) => {
      const out = { ...up.headers };
      delete out['access-control-allow-origin'];
      res.writeHead(up.statusCode, out);
      up.pipe(res);
    });
    upstream.on('error', (e) => {
      res.writeHead(502);
      res.end(String(e));
    });
    req.pipe(upstream);
  })
  .listen(Number(gatewayPort), '127.0.0.1');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };
http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(webDir, urlPath);
    if (!file.startsWith(path.resolve(webDir)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(webDir, 'index.html');
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(Number(webPort), '127.0.0.1');
