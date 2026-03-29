const { getHqAdmins, setHqAdmins, ensureDefaultHqAdminIfEmpty } = require('./storage');
const { verifyHqSessionFromEvent } = require('./hq-session');

const MENU_KEYS = [
  'overview',
  'stores',
  'members',
  'accountQueue',
  'settlement',
  'pointLedger',
  'walletMgmt',
  'blacklist',
  'settings',
];

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

function getBootstrapSecrets() {
  const a = process.env.HQ_ACCOUNT_VERIFY_SECRET;
  const b = process.env.HQ_BOOTSTRAP_SECRET;
  return [a, b].filter((x) => x != null && String(x).length > 0).map((x) => String(x));
}

function normalizeStoredAdmin(a) {
  if (!a || typeof a !== 'object') return null;
  let level = parseInt(a.level, 10);
  if (![1, 2, 3].includes(level)) level = 1;
  let menuViews = [];
  if (level === 3 && Array.isArray(a.menuViews)) {
    menuViews = MENU_KEYS.filter((k) => a.menuViews.includes(k));
  }
  const id = String(a.id || '').trim();
  if (!id) return null;
  const out = {
    id,
    password: String(a.password || ''),
    nickname: a.nickname != null && String(a.nickname).trim() !== '' ? String(a.nickname).trim() : id,
    level,
  };
  if (level === 3 && menuViews.length) out.menuViews = menuViews;
  return out;
}

async function loadAndMigrateAdmins(event) {
  const raw = await getHqAdmins(event);
  let dirty = false;
  const normalized = [];
  for (const row of raw) {
    if (row && row.level == null) dirty = true;
    const n = normalizeStoredAdmin(row);
    if (n) normalized.push(n);
  }
  if (dirty && normalized.length) await setHqAdmins(event, normalized);
  return normalized;
}

function toPublicAdmin(a) {
  return {
    id: a.id,
    nickname: a.nickname,
    level: a.level,
    menuViews: a.level === 3 ? a.menuViews || [] : null,
  };
}

function sessionCanManageStaff(session) {
  return session && session.level <= 2;
}

function canModifySubordinate(sessionLevel, targetLevel) {
  return targetLevel > sessionLevel;
}

function filterListForSession(session, admins) {
  if (session.level >= 3) return [];
  if (session.level === 1) return admins;
  return admins.filter((x) => x.level === 3);
}

function filterMenuViewsInput(arr) {
  if (!Array.isArray(arr)) return [];
  return MENU_KEYS.filter((k) => arr.includes(k));
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Invalid JSON' });
  }
  const action = body.action;

  try {
    if (action === 'status') {
      await ensureDefaultHqAdminIfEmpty(event);
      const admins = await loadAndMigrateAdmins(event);
      return json(200, { ok: true, needBootstrap: admins.length === 0, adminCount: admins.length });
    }

    if (action === 'bootstrap') {
      await ensureDefaultHqAdminIfEmpty(event);
      const admins = await loadAndMigrateAdmins(event);
      if (admins.length > 0) return json(400, { error: '이미 본사 관리자가 등록되어 있습니다.' });
      const secrets = getBootstrapSecrets();
      const got = String(body.setupSecret || '');
      if (secrets.length === 0) {
        return json(400, {
          error: '서버에 HQ_ACCOUNT_VERIFY_SECRET 또는 HQ_BOOTSTRAP_SECRET 환경변수를 설정한 뒤, 여기에 동일한 값을 입력하세요.',
        });
      }
      if (!secrets.includes(got)) {
        return json(403, { error: '설정용 비밀번호가 올바르지 않습니다.' });
      }
      const id = String(body.id || '').trim();
      const password = String(body.password || '');
      const nickname = String(body.nickname || '').trim() || id;
      if (!id || !password) return json(400, { error: '아이디와 비밀번호를 입력하세요.' });
      await setHqAdmins(event, [normalizeStoredAdmin({ id, password, nickname, level: 1 })]);
      return json(200, { ok: true });
    }

    const session = verifyHqSessionFromEvent(event);
    if (!session) return json(403, { error: '로그인이 필요합니다.' });
    const sessionLevel = Number(session.level) || 1;

    if (action === 'list') {
      if (!sessionCanManageStaff(session)) return json(403, { error: '권한이 없습니다.' });
      const admins = await loadAndMigrateAdmins(event);
      const list = filterListForSession(session, admins).map(toPublicAdmin);
      return json(200, { ok: true, admins: list });
    }

    if (action === 'add') {
      if (!sessionCanManageStaff(session)) return json(403, { error: '권한이 없습니다.' });
      const id = String(body.id || '').trim();
      const password = String(body.password || '');
      const nickname = String(body.nickname || '').trim() || id;
      const newLevel = parseInt(body.level, 10);
      const menuViews = filterMenuViewsInput(body.menuViews);
      if (!id || !password) return json(400, { error: '아이디와 비밀번호를 입력하세요.' });
      if (![2, 3].includes(newLevel) || newLevel <= sessionLevel) {
        return json(400, { error: '생성할 수 있는 등급이 아닙니다. 하위 등급만 추가할 수 있습니다.' });
      }
      if (newLevel === 3 && menuViews.length === 0) {
        return json(400, { error: '운영 관리자(3등급)는 허용할 메뉴를 하나 이상 선택해야 합니다.' });
      }
      let admins = await loadAndMigrateAdmins(event);
      if (admins.some((a) => a && a.id === id)) return json(400, { error: '이미 존재하는 아이디입니다.' });
      const row = { id, password, nickname, level: newLevel };
      if (newLevel === 3) row.menuViews = menuViews;
      admins.push(normalizeStoredAdmin(row));
      await setHqAdmins(event, admins);
      return json(200, { ok: true });
    }

    if (action === 'remove') {
      if (!sessionCanManageStaff(session)) return json(403, { error: '권한이 없습니다.' });
      const id = String(body.id || '').trim();
      if (!id) return json(400, { error: 'id required' });
      let admins = await loadAndMigrateAdmins(event);
      if (admins.length <= 1) return json(400, { error: '마지막 본사 관리자는 삭제할 수 없습니다.' });
      if (session.id === id) {
        return json(400, { error: '현재 로그인한 계정은 삭제할 수 없습니다. 다른 관리자로 로그인한 뒤 삭제하세요.' });
      }
      const target = admins.find((a) => a && a.id === id);
      if (!target) return json(400, { error: '해당 관리자를 찾을 수 없습니다.' });
      if (!canModifySubordinate(sessionLevel, target.level)) {
        return json(403, { error: '하위 관리자만 삭제할 수 있습니다.' });
      }
      admins = admins.filter((a) => a && a.id !== id);
      await setHqAdmins(event, admins);
      return json(200, { ok: true });
    }

    if (action === 'update') {
      if (!sessionCanManageStaff(session)) return json(403, { error: '권한이 없습니다.' });
      const id = String(body.id || '').trim();
      if (!id) return json(400, { error: 'id required' });
      let admins = await loadAndMigrateAdmins(event);
      const idx = admins.findIndex((a) => a && a.id === id);
      if (idx === -1) return json(400, { error: '해당 관리자를 찾을 수 없습니다.' });
      const target = admins[idx];
      const isSelf = session.id === id;

      if (isSelf) {
        if (body.level != null || body.menuViews != null) {
          return json(403, { error: '본인 계정의 등급·메뉴는 변경할 수 없습니다.' });
        }
        const next = { ...target };
        if (body.nickname != null) {
          const nn = String(body.nickname || '').trim();
          next.nickname = nn || target.id;
        }
        if (body.password != null && String(body.password).length > 0) {
          next.password = String(body.password);
        }
        admins[idx] = normalizeStoredAdmin(next);
        await setHqAdmins(event, admins);
        return json(200, { ok: true });
      }

      if (!canModifySubordinate(sessionLevel, target.level)) {
        return json(403, { error: '하위 관리자만 수정할 수 있습니다.' });
      }

      let nextLevel = target.level;
      if (body.level != null) {
        const nl = parseInt(body.level, 10);
        if (![1, 2, 3].includes(nl)) return json(400, { error: '유효하지 않은 등급입니다.' });
        if (nl <= sessionLevel) return json(403, { error: '설정할 수 있는 등급이 아닙니다.' });
        nextLevel = nl;
      }

      let nextMenu = target.menuViews ? [...target.menuViews] : [];
      if (body.menuViews != null) {
        nextMenu = filterMenuViewsInput(body.menuViews);
      }
      if (nextLevel < 3) nextMenu = [];

      if (nextLevel === 3 && nextMenu.length === 0) {
        return json(400, { error: '운영 관리자(3등급)는 허용할 메뉴를 하나 이상 선택해야 합니다.' });
      }

      const next = {
        ...target,
        level: nextLevel,
        nickname:
          body.nickname != null
            ? String(body.nickname || '').trim() || target.id
            : target.nickname,
      };
      if (body.password != null && String(body.password).length > 0) {
        next.password = String(body.password);
      }
      if (nextLevel === 3) next.menuViews = nextMenu;
      else delete next.menuViews;

      admins[idx] = normalizeStoredAdmin(next);
      await setHqAdmins(event, admins);
      return json(200, { ok: true });
    }

    return json(400, { error: 'unknown action' });
  } catch (err) {
    console.error('hq-admins', err);
    return json(500, { error: 'Server error' });
  }
};
