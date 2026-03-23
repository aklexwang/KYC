const { getHqAdmins, setHqAdmins, ensureDefaultHqAdminIfEmpty } = require('./storage');
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

function getBootstrapSecrets() {
  const a = process.env.HQ_ACCOUNT_VERIFY_SECRET;
  const b = process.env.HQ_BOOTSTRAP_SECRET;
  return [a, b].filter((x) => x != null && String(x).length > 0).map((x) => String(x));
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
      const admins = await getHqAdmins(event);
      return json(200, { ok: true, needBootstrap: admins.length === 0, adminCount: admins.length });
    }

    if (action === 'bootstrap') {
      await ensureDefaultHqAdminIfEmpty(event);
      const admins = await getHqAdmins(event);
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
      await setHqAdmins(event, [{ id, password, nickname }]);
      return json(200, { ok: true });
    }

    const session = verifyHqSessionFromEvent(event);
    if (!session) return json(403, { error: '로그인이 필요합니다.' });

    if (action === 'list') {
      const admins = await getHqAdmins(event);
      const list = admins.map(({ id, nickname }) => ({
        id,
        nickname: nickname != null && String(nickname).trim() !== '' ? String(nickname).trim() : id,
      }));
      return json(200, { ok: true, admins: list });
    }

    if (action === 'add') {
      const id = String(body.id || '').trim();
      const password = String(body.password || '');
      const nickname = String(body.nickname || '').trim() || id;
      if (!id || !password) return json(400, { error: '아이디와 비밀번호를 입력하세요.' });
      const admins = await getHqAdmins(event);
      if (admins.some((a) => a && a.id === id)) return json(400, { error: '이미 존재하는 아이디입니다.' });
      admins.push({ id, password, nickname });
      await setHqAdmins(event, admins);
      return json(200, { ok: true });
    }

    if (action === 'remove') {
      const id = String(body.id || '').trim();
      if (!id) return json(400, { error: 'id required' });
      let admins = await getHqAdmins(event);
      if (admins.length <= 1) return json(400, { error: '마지막 본사 관리자는 삭제할 수 없습니다.' });
      if (session.id === id) {
        return json(400, { error: '현재 로그인한 계정은 삭제할 수 없습니다. 다른 관리자로 로그인한 뒤 삭제하세요.' });
      }
      admins = admins.filter((a) => a && a.id !== id);
      await setHqAdmins(event, admins);
      return json(200, { ok: true });
    }

    return json(400, { error: 'unknown action' });
  } catch (err) {
    console.error('hq-admins', err);
    return json(500, { error: 'Server error' });
  }
};
