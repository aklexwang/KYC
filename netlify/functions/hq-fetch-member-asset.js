const { verifyHqSessionFromEvent } = require('./hq-session');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-HQ-Admin-Token',
};

function json(status, obj) {
  return {
    statusCode: status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}

function isBlockedHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '0.0.0.0') return true;
  if (h.startsWith('127.')) return true;
  if (h.startsWith('10.')) return true;
  if (h.startsWith('192.168.')) return true;
  if (h.startsWith('172.')) {
    const p = h.split('.');
    const n = parseInt(p[1], 10);
    if (!Number.isNaN(n) && n >= 16 && n <= 31) return true;
  }
  if (h === '169.254.169.254') return true;
  return false;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const admin = verifyHqSessionFromEvent(event);
  if (!admin) return json(401, { error: '본사 관리자 세션이 필요합니다.' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Invalid JSON' });
  }

  const raw = String(body.url || '').trim();
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
    return json(400, { error: 'http(s) URL만 허용됩니다.' });
  }

  let u;
  try {
    u = new URL(raw);
  } catch (e) {
    return json(400, { error: '잘못된 URL입니다.' });
  }

  if (u.username || u.password) {
    return json(400, { error: 'URL에 인증 정보를 포함할 수 없습니다.' });
  }

  if (isBlockedHost(u.hostname)) {
    return json(400, { error: '해당 호스트는 차단되었습니다.' });
  }

  try {
    const r = await fetch(raw, {
      redirect: 'follow',
      headers: { 'User-Agent': 'KYC-HQ-MemberExport/1.0' },
    });
    if (!r.ok) {
      return json(502, { error: '이미지를 가져오지 못했습니다.', upstreamStatus: r.status });
    }
    const ctRaw = r.headers.get('content-type') || '';
    const ct = ctRaw.split(';')[0].trim().toLowerCase();
    const allowed =
      ct.startsWith('image/') || ct === 'application/octet-stream' || ct === 'binary/octet-stream';
    if (!allowed) {
      return json(415, { error: '이미지가 아닌 응답입니다.', contentType: ctRaw });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const max = 15 * 1024 * 1024;
    if (buf.length > max) {
      return json(413, { error: '파일이 너무 큽니다.' });
    }
    return json(200, {
      ok: true,
      contentType: ct || 'application/octet-stream',
      data: buf.toString('base64'),
    });
  } catch (e) {
    console.error('hq-fetch-member-asset', e);
    return json(502, { error: '이미지 요청에 실패했습니다.' });
  }
};
