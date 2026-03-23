/**
 * Netlify CLI 없이 로컬에서 정적 파일 + Functions를 띄웁니다.
 * 사용: node scripts/local-dev-server.js
 * 브라우저: http://127.0.0.1:8888/admin-headquarters.html
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const FUNCTIONS = path.join(ROOT, 'netlify', 'functions');
const PORT = Number(process.env.LOCAL_DEV_PORT || 8888);

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const i = t.indexOf('=');
      if (i <= 0) return;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key) process.env[key] = val;
    });
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[local-dev] .env 읽기:', e.message);
  }
}

loadEnvFile();

const API_MAP = {
  '/api/kyc': 'kyc.js',
  '/api/members': 'members.js',
  '/api/stores': 'stores.js',
  '/api/create-store': 'create-store.js',
  '/api/store-allowed-ips': 'store-allowed-ips.js',
  '/api/usage-prices': 'usage-prices.js',
  '/api/store-login': 'store-login.js',
  '/api/store-prices': 'store-prices.js',
  '/api/store-points': 'store-points.js',
  '/api/store-gate-config': 'store-gate-config.js',
  '/api/store-point-recharge-request': 'store-point-recharge-request.js',
  '/api/store-point-recharge-resolve': 'store-point-recharge-resolve.js',
  '/api/store-suspend': 'store-suspend.js',
  '/api/store-delete': 'store-delete.js',
  '/api/account-verify': 'account-verify.js',
  '/api/hq-login': 'hq-login.js',
  '/api/hq-admins': 'hq-admins.js',
  '/api/hq-fetch-member-asset': 'hq-fetch-member-asset.js',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseQuery(search) {
  const q = {};
  const params = new URLSearchParams(search || '');
  params.forEach((v, k) => {
    q[k] = v;
  });
  return q;
}

async function invokeFunction(relFile, event) {
  const full = path.join(FUNCTIONS, relFile);
  const mod = require(full);
  if (typeof mod.handler !== 'function') {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'no handler' }) };
  }
  return mod.handler(event, {});
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname.replace(/\/$/, '') || '/';

    if (pathname.startsWith('/api/')) {
      const apiPath = pathname;
      const file = API_MAP[apiPath];
      if (!file) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unknown api', path: apiPath }));
        return;
      }

      if (req.method === 'OPTIONS') {
        const result = await invokeFunction(file, {
          httpMethod: 'OPTIONS',
          path: apiPath,
          headers: req.headers,
          body: null,
          queryStringParameters: null,
          rawUrl: req.url,
        });
        sendLambdaResult(res, result);
        return;
      }

      const body = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' ? await collectBody(req) : '';
      const queryStringParameters = parseQuery(url.search.replace(/^\?/, ''));
      const qs = Object.keys(queryStringParameters).length ? queryStringParameters : null;

      const event = {
        httpMethod: req.method,
        path: apiPath,
        headers: req.headers,
        body: body || null,
        queryStringParameters: qs,
        rawUrl: req.url,
      };

      const result = await invokeFunction(file, event);
      sendLambdaResult(res, result);
      return;
    }

    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    const resolved = path.resolve(ROOT, rel);
    const relToRoot = path.relative(ROOT, resolved);
    if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.stat(resolved, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found: ' + rel);
        return;
      }
      const ext = path.extname(resolved).toLowerCase();
      const ct = MIME[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': ct });
      fs.createReadStream(resolved).pipe(res);
    });
  } catch (e) {
    console.error(e);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(String(e.message || e));
  }
});

function sendLambdaResult(res, result) {
  const status = result.statusCode || 200;
  const headers = result.headers || {};
  const body = result.body != null ? result.body : '';
  res.writeHead(status, headers);
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

server.listen(PORT, '127.0.0.1', () => {
  console.log('[KYC local] http://127.0.0.1:' + PORT + '/admin-headquarters.html');
  console.log('[KYC local] API 프록시 · KYC_LOCAL_FALLBACK=' + (process.env.KYC_LOCAL_FALLBACK || '(없음)'));
});
