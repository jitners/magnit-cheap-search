'use strict';

// Minimal local emulator of the Vercel deployment: /api/* -> serverless handlers,
// everything else -> public/ files. Used only for testing.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const root = __dirname;
const port = Number(process.env.PORT || 5090);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + port);

  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/\/+$/, '');
    const file = path.join(root, 'api', name + '.js');
    if (!fs.existsSync(file)) return sendJson(res, 404, { error: 'Not found' });
    delete require.cache[require.resolve(file)];

    const handler = require(file);
    const query = Object.fromEntries(url.searchParams.entries());
    try {
      await handler({ method: req.method, query, headers: req.headers }, res);
    } catch (err) {
      if (!res.writableEnded) sendJson(res, 500, { error: String(err && err.message || err) });
    }
    return;
  }

  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = decodeURIComponent(filePath);
  const full = path.join(root, 'public', filePath);

  if (!full.startsWith(path.join(root, 'public')) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not found');
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', mime[path.extname(full).toLowerCase()] || 'application/octet-stream');
  fs.createReadStream(full).pipe(res);
});

server.listen(port, () => console.log('test server on http://localhost:' + port));
