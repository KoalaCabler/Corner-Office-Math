// Corner Office Math - a small, dependency-free Node server.
// Serves the web page from /public and the data files from /data.
// Run: node server.js   (needs Node 18 or newer)

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// Only these data files are public; data/cache stays private to the build.
function dataFile(urlPath) {
  if (urlPath === '/data/index.json') return path.join(DATA, 'index.json');
  const m = urlPath.match(/^\/data\/companies\/([A-Za-z0-9-]+)\.json$/);
  return m ? path.join(DATA, 'companies', `${m[1].toUpperCase()}.json`) : null;
}

function send(req, res, file, cacheSeconds) {
  fs.readFile(file, (err, body) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const headers = {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': `public, max-age=${cacheSeconds}`,
      'X-Content-Type-Options': 'nosniff',
    };
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '') && body.length > 1024 && /json|text|javascript|svg/.test(headers['Content-Type'])) {
      body = zlib.gzipSync(body);
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = 'Accept-Encoding';
    }
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }

  if (urlPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  if (urlPath.startsWith('/data/')) {
    const file = dataFile(urlPath);
    if (!file) {
      res.writeHead(404);
      return res.end('Not found');
    }
    return send(req, res, file, 3600);
  }

  // Static files; every other path gets the single-page app.
  const file = path.normalize(path.join(PUBLIC, urlPath));
  if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    return send(req, res, file, urlPath.endsWith('.html') ? 0 : 3600);
  }
  return send(req, res, path.join(PUBLIC, 'index.html'), 0);
});

server.listen(PORT, () => console.log(`Corner Office Math running at http://localhost:${PORT}`));
