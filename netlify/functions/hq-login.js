const { getHqAdmins, ensureDefaultHqAdminIfEmpty } = require('./storage');
const { createToken, verifyToken, getSecret } = require('./hq-session');

const HQ_MENU_KEYS = [
  'overview',
  'stores',
  'members',
  'accountQueue',
  'settlement',
  'pointLedger',
  'walletMgmt',
  'settings',
];

function normalizeHqAdminRow(row) {
  if (!row || typeof row !== 'object') return null;
  let level = parseInt(row.level, 10);
  if (![1, 2, 3].includes(level)) level = 1;
  let menuViews = [];
  if (level === 3 && Array.isArray(row.menuViews)) {
    menuViews = row.menuViews.filter((k) => typeof k === 'string' && HQ_MENU_KEYS.includes(k));
  }
  const id = String(row.id || '').trim();
  return {
    id,
    password: String(row.password || ''),
    nickname: row.nickname != null && String(row.nickname).trim() !== '' ? String(row.nickname).trim() : id,
    level,
    ...(level === 3 && menuViews.length ? { menuViews } : {}),
  };
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return {
    statusCode: status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  if (!getSecret()) {
    return json(503, {
      error: 'server_config',
      message: 'Netlify 환경변수 HQ_SESSION_SECRET 또는 HQ_ACCOUNT_VERIFY_SECRET을 설정해 주세요.',
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Invalid JSON' });
  }

  try {
    await ensureDefaultHqAdminIfEmpty(event);
  } catch (e) {
    console.warn('ensureDefaultHqAdminIfEmpty', e);
  }

  if (body.action === 'validate') {
    const v = verifyToken(String(body.token || '').trim());
    if (!v) return json(200, { ok: false, admin: null });
    return json(200, {
      ok: true,
      admin: {
        id: v.id,
        nickname: v.nickname,
        level: v.level,
        menuViews: v.level === 3 ? v.menuViews || [] : null,
      },
    });
  }

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!id || !password) {
    return json(400, { error: 'id and password required' });
  }

  try {
    const admins = await getHqAdmins(event);
    const rawRow = admins.find((a) => a && a.id === id && a.password === password);
    if (!rawRow) {
      return json(401, { error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }
    const row = normalizeHqAdminRow(rawRow);
    if (!row) {
      return json(401, { error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }
    const nickname = row.nickname;
    const token = createToken(row.id, nickname, row.level, row.level === 3 ? row.menuViews || [] : null);
    return json(200, {
      ok: true,
      token,
      adminId: row.id,
      nickname,
      level: row.level,
      menuViews: row.level === 3 ? row.menuViews || [] : null,
    });
  } catch (err) {
    console.error('hq-login', err);
    return json(500, { error: 'Server error' });
  }
};
