const { getKycData, setKycData, incrementUsage, getStorageErrorHelp } = require('./storage');
const { verifyHqSessionFromEvent } = require('./hq-session');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-HQ-Secret, X-HQ-Admin-Token',
};

function json(status, obj) {
  return {
    statusCode: status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}

function checkHqSecret(event) {
  const secret = process.env.HQ_ACCOUNT_VERIFY_SECRET;
  if (!secret) return true;
  const h = event.headers || {};
  const got = h['x-hq-secret'] || h['X-HQ-Secret'] || '';
  return got === secret;
}

async function findMemberIndex(event, storeId, memberName) {
  const { data } = await getKycData(event);
  const sid = String(storeId || '').trim();
  const name = String(memberName || '').trim();
  const list = Array.isArray(data[sid]) ? data[sid] : [];
  const idx = list.findIndex((m) => m && m.name === name);
  return { data, sid, list, idx };
}

/** 회원 화면 폴링: 입금 4자리는 code_sent 일 때만 내려줌 */
async function memberPoll(event, storeId, memberName) {
  try {
    const { list, idx } = await findMemberIndex(event, storeId, memberName);
    if (idx < 0) {
      return json(200, { ok: true, accountVerifyStatus: 'none', depositCode4: null, bankName: '' });
    }
    const m = list[idx];
    const st = m.accountVerifyStatus || 'none';
    const showCode = st === 'code_sent' && m.depositCode4;
    return json(200, {
      ok: true,
      accountVerifyStatus: st,
      depositCode4: showCode ? String(m.depositCode4) : null,
      bankName: m.bankName || '',
    });
  } catch (err) {
    console.error('memberPoll', err);
    const help = getStorageErrorHelp();
    return json(500, { error: 'Storage error', message: (err.message || '') + (help ? '\n\n' + help : '') });
  }
}

/** 본사: 대기·입금코드 발송 후 대기 중인 건만 */
async function queueList(event) {
  try {
    const { data, names } = await getKycData(event);
    const items = [];
    const dataObj = data && typeof data === 'object' ? data : {};
    Object.keys(dataObj).forEach((sid) => {
      const list = Array.isArray(dataObj[sid]) ? dataObj[sid] : [];
      list.forEach((m) => {
        if (!m || !m.name) return;
        const st = m.accountVerifyStatus || 'none';
        if (st === 'pending' || st === 'code_sent') {
          items.push({
            storeId: sid,
            storeName: (names && names[sid]) ? names[sid] : sid,
            memberName: m.name,
            bankName: m.bankName || '',
            accountNumber: m.accountNumber || '',
            accountHolder: m.accountHolder || '',
            status: st,
            requestedAt: m.accountVerifyRequestedAt || '',
            codeSentByNickname: m.accountVerifyCodeSentByNickname || '',
            codeSentById: m.accountVerifyCodeSentById || '',
            codeSentAt: m.accountVerifyCodeSentAt || '',
          });
        }
      });
    });
    items.sort((a, b) => String(b.requestedAt || '').localeCompare(String(a.requestedAt || '')));
    return json(200, { ok: true, items });
  } catch (err) {
    console.error('queueList', err);
    const help = getStorageErrorHelp();
    return json(500, { error: 'Storage error', message: (err.message || '') + (help ? '\n\n' + help : '') });
  }
}

async function hqSetDepositCode(event, body) {
  const session = verifyHqSessionFromEvent(event);
  const legacyOk = checkHqSecret(event);
  if (!session && !legacyOk) return json(403, { error: 'forbidden' });
  const storeId = String(body.storeId || '').trim();
  const memberName = String(body.memberName || '').trim();
  const code4 = String(body.code4 || '').replace(/\D/g, '').slice(0, 4);
  if (!storeId || !memberName || code4.length !== 4) {
    return json(400, { error: 'storeId, memberName, code4(4 digits) required' });
  }
  try {
    const { data, list, idx } = await findMemberIndex(event, storeId, memberName);
    if (idx < 0) return json(404, { error: 'member not found' });
    const prev = list[idx];
    if ((prev.accountVerifyStatus || 'none') !== 'pending') {
      return json(400, { error: 'pending만 처리 가능합니다.', status: prev.accountVerifyStatus || 'none' });
    }
    const operatorNickname = session ? session.nickname : '시크릿키';
    const operatorId = session ? session.id : '';
    list[idx] = {
      ...prev,
      depositCode4: code4,
      accountVerifyStatus: 'code_sent',
      accountVerifyCodeSentAt: new Date().toISOString(),
      accountVerifyCodeSentByNickname: operatorNickname,
      accountVerifyCodeSentById: operatorId,
    };
    await setKycData(event, data, null);
    return json(200, { ok: true });
  } catch (err) {
    console.error('hqSetDepositCode', err);
    const help = getStorageErrorHelp();
    return json(500, { error: 'Storage error', message: (err.message || '') + (help ? '\n\n' + help : '') });
  }
}

async function memberVerifyCode(event, body) {
  const storeId = String(body.storeId || '').trim();
  const memberName = String(body.memberName || '').trim();
  const code4 = String(body.code4 || '').replace(/\D/g, '').slice(0, 4);
  if (!storeId || !memberName || code4.length !== 4) {
    return json(400, { error: 'storeId, memberName, code4 required' });
  }
  try {
    const { data, list, idx } = await findMemberIndex(event, storeId, memberName);
    if (idx < 0) return json(404, { error: 'member not found' });
    const prev = list[idx];
    if ((prev.accountVerifyStatus || 'none') !== 'code_sent') {
      return json(400, { error: '입금 코드가 아직 없습니다.' });
    }
    if (String(prev.depositCode4) !== code4) {
      return json(200, { ok: true, match: false });
    }
    const wasComplete = prev.account === 'complete';
    list[idx] = {
      ...prev,
      account: 'complete',
      accountVerifyStatus: 'complete',
    };
    await setKycData(event, data, null);
    if (!wasComplete) await incrementUsage(event, storeId, 'account');
    return json(200, { ok: true, match: true });
  } catch (err) {
    console.error('memberVerifyCode', err);
    const help = getStorageErrorHelp();
    return json(500, { error: 'Storage error', message: (err.message || '') + (help ? '\n\n' + help : '') });
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  if (event.httpMethod === 'GET') {
    const q = event.queryStringParameters || {};
    if (q.store && q.member) {
      let store = String(q.store);
      let member = String(q.member);
      try {
        store = decodeURIComponent(store);
        member = decodeURIComponent(member);
      } catch (e) {}
      return memberPoll(event, store, member);
    }
    return queueList(event);
  }

  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return json(400, { error: 'Invalid JSON' });
    }
    const action = body.action;
    if (action === 'hqSetDepositCode') return hqSetDepositCode(event, body);
    if (action === 'memberVerifyCode') return memberVerifyCode(event, body);
    return json(400, { error: 'unknown action' });
  }

  return json(405, { error: 'Method not allowed' });
};
