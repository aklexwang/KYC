const crypto = require('crypto');
const { getStorageErrorHelp } = require('./storage');

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_UPSTASH = !!(UPSTASH_URL && UPSTASH_TOKEN);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
};

function json(status, obj) {
  return {
    statusCode: status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('base64url');
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function getClientIp(event) {
  const h = event.headers || {};
  const xff = String(h['x-forwarded-for'] || h['X-Forwarded-For'] || '').trim();
  if (xff) return xff.split(',')[0].trim();
  return String(h['client-ip'] || h['Client-Ip'] || h['x-nf-client-connection-ip'] || h['X-Nf-Client-Connection-Ip'] || 'unknown').trim() || 'unknown';
}

function checkApiKey(event) {
  const expected = String(process.env.COMPLETION_CODE_API_KEY || '').trim();
  if (!expected) return true;
  const headers = event.headers || {};
  const provided = String(headers['x-api-key'] || headers['X-API-Key'] || headers['authorization'] || headers['Authorization'] || '').trim();
  if (!provided) return false;
  if (provided.toLowerCase().startsWith('bearer ')) {
    return provided.slice(7).trim() === expected;
  }
  return provided === expected;
}

async function upstashGetRaw(key) {
  const res = await fetch(UPSTASH_URL + '/get/' + encodeURIComponent(key), {
    headers: { Authorization: 'Bearer ' + UPSTASH_TOKEN },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('upstash_get_http_' + String(res.status));
  if (json && json.error) throw new Error(String(json.error));
  return json ? json.result : null;
}

async function upstashDel(key) {
  const res = await fetch(UPSTASH_URL + '/del/' + encodeURIComponent(key), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + UPSTASH_TOKEN },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('upstash_del_http_' + String(res.status));
  if (json && json.error) throw new Error(String(json.error));
  return json ? json.result : 0;
}

async function upstashPipeline(commands) {
  const res = await fetch(UPSTASH_URL + '/pipeline', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + UPSTASH_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('upstash_pipeline_http_' + String(res.status));
  if (json && json.error) throw new Error(String(json.error));
  return Array.isArray(json) ? json : [];
}

async function checkRateLimit(event) {
  const limitRaw = parseInt(String(process.env.COMPLETION_CODE_VERIFY_PER_MINUTE || '30'), 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 30;
  const ip = getClientIp(event);
  const minuteBucket = Math.floor(Date.now() / 60000);
  const key = 'rl:completion-verify:' + ip + ':' + minuteBucket;
  const rows = await upstashPipeline([
    ['INCR', key],
    ['EXPIRE', key, '70'],
  ]);
  const used = Number(rows && rows[0] ? rows[0].result : 0) || 0;
  if (used > limit) {
    return { ok: false, limit, used };
  }
  return { ok: true, limit, used };
}

async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { valid: false, reason: 'method_not_allowed', error: 'Method not allowed' });
  }
  if (!USE_UPSTASH) {
    return json(503, {
      valid: false,
      reason: 'not_configured',
      error: 'not_configured',
      message: 'Upstash Redis is required for completion code verification.',
    });
  }
  if (!checkApiKey(event)) {
    return json(401, { valid: false, reason: 'unauthorized', error: 'unauthorized' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { valid: false, reason: 'invalid_json', error: 'Invalid JSON' });
  }

  const code = String(body.code || '').replace(/\D/g, '').slice(0, 6);
  if (code.length !== 6) {
    return json(400, { valid: false, reason: 'code_required' });
  }

  const phone = body.phone ? normalizePhone(body.phone) : '';

  try {
    const rl = await checkRateLimit(event);
    if (!rl.ok) {
      return json(429, { valid: false, reason: 'rate_limited', limit: rl.limit, used: rl.used });
    }

    const key = 'kyc:completion:code:' + code;
    const raw = await upstashGetRaw(key);
    if (raw == null) {
      return json(200, { valid: false, reason: 'invalid_code' });
    }

    let payload;
    try {
      payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      payload = null;
    }
    if (!payload || payload.kycComplete !== true) {
      return json(200, { valid: false, reason: 'invalid_code' });
    }

    const savedPhone = normalizePhone(payload && payload.user ? payload.user.phone : '');
    if (phone && savedPhone && savedPhone !== phone) {
      return json(200, { valid: false, reason: 'phone_mismatch' });
    }

    await upstashDel(key);

    return json(200, {
      valid: true,
      accountInfo: payload.accountInfo || null,
      user: payload.user || null,
      createdAt: payload.createdAt || null,
    });
  } catch (err) {
    console.error('verify-completion-code', err);
    const help = getStorageErrorHelp();
    return json(500, {
      valid: false,
      reason: 'storage_error',
      error: 'Storage error',
      message: (err.message || '') + (help ? '\n\n' + help : ''),
    });
  }
}

exports.handler = handler;
