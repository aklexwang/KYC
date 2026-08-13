const crypto = require('crypto');
const { getKycData, setKycData, incrementUsage, incrementDailyKycComplete, getStorageErrorHelp } = require('./storage');
const { verifyHqSessionFromEvent } = require('./hq-session');
const { telegramNotify, telegramKycLine } = require('./_telegram-notify');

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_UPSTASH = !!(UPSTASH_URL && UPSTASH_TOKEN);

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

function randomCompletionCode6() {
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(6, '0');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('base64url');
}

function maskAccountNumber(accountNumber) {
  const raw = String(accountNumber || '').replace(/\D/g, '');
  if (!raw) return '';
  if (raw.length <= 8) return raw.replace(/./g, '*');
  const left = raw.slice(0, 2);
  const right = raw.slice(-4);
  return left + raw.slice(2, -4).replace(/./g, '*') + right;
}

function maskName(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  if (raw.length === 1) return '*';
  return raw[0] + raw.slice(1).replace(/./g, '*');
}

function makeCompletionAccountInfo(member) {
  return {
    bankName: String(member.bankName || '').trim(),
    accountNumber: maskAccountNumber(member.accountNumber || ''),
    accountHolder: maskName(member.accountHolder || ''),
  };
}

function generateUniqueCompletionCode(data) {
  const existingHashes = new Set();
  const dataObj = data && typeof data === 'object' ? data : {};
  Object.keys(dataObj).forEach((sid) => {
    const list = Array.isArray(dataObj[sid]) ? dataObj[sid] : [];
    list.forEach((m) => {
      if (m && m.completionCodeHash) existingHashes.add(String(m.completionCodeHash));
    });
  });
  for (let attempts = 0; attempts < 50; attempts += 1) {
    const code = randomCompletionCode6();
    const hash = hashCode(code);
    if (!existingHashes.has(hash)) return { code, hash };
  }
  throw new Error('unable to generate unique completion code');
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
  if (!res.ok) {
    throw new Error('upstash_pipeline_http_' + String(res.status));
  }
  if (json && json.error) {
    throw new Error(String(json.error));
  }
  return Array.isArray(json) ? json : [];
}

async function saveCompletionCodeToUpstash(code6, payload, ttlSec) {
  if (!USE_UPSTASH) {
    throw new Error('upstash_not_configured');
  }
  const key = 'kyc:completion:code:' + String(code6);
  const body = JSON.stringify(payload);
  const rows = await upstashPipeline([
    ['SET', key, body, 'EX', String(ttlSec), 'NX'],
  ]);
  return !!(rows && rows[0] && rows[0].result === 'OK');
}

async function issueCompletionCodeToUpstash(data, payload, ttlSec) {
  for (let attempts = 0; attempts < 50; attempts += 1) {
    const candidate = generateUniqueCompletionCode(data);
    const saved = await saveCompletionCodeToUpstash(candidate.code, payload, ttlSec);
    if (saved) return candidate;
  }
  throw new Error('completion_code_collision_retry_exhausted');
}

/**
 * 임시 운영 모드: 1원 인증 4자리는 아무 숫자 4자리면 통과 처리합니다.
 * 필요 시 FORCE_FIXED_ACCOUNT_CODE=0 으로 원래 일치 검증으로 복귀할 수 있습니다.
 */
function useFixedAccountCodeMode() {
  const raw = String(process.env.FORCE_FIXED_ACCOUNT_CODE || '1').toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(raw);
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
    const hqDone = !!(m.hqOneWonTransferConfirmedAt);
    /** 본사가 이체「완료」를 눌러 입금 알림을 허용한 뒤에만 회원에게 4자리·은행명 공개 */
    const showCode =
      (st === 'code_sent' || st === 'pending') && m.depositCode4 && hqDone;
    /** 서버에 4자리는 있으나 본사 이체 확인 전 — 회원 화면은 'KYC 확인중' */
    const hqAwaitingTransferConfirm = !!(
      (st === 'code_sent' || st === 'pending') && m.depositCode4 && !hqDone
    );
    return json(200, {
      ok: true,
      accountVerifyStatus: st,
      depositCode4: showCode ? String(m.depositCode4) : null,
      hqAwaitingTransferConfirm,
      bankName: m.bankName || '',
      cancelReason: st === 'cancelled' ? String(m.accountVerifyCancelReason || '') : '',
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
            memberAccount: m.account || 'wait',
            depositCode4: m.depositCode4 ? String(m.depositCode4) : '',
            requestedAt: m.accountVerifyRequestedAt || '',
            completedAt: m.accountVerifyCompletedAt || '',
            cancelledAt: m.accountVerifyCancelledAt || '',
            cancelReason: m.accountVerifyCancelReason || '',
            codeSentByNickname: m.accountVerifyCodeSentByNickname || '',
            codeSentById: m.accountVerifyCodeSentById || '',
            codeSentAt: m.accountVerifyCodeSentAt || '',
            expiresAt: m.accountVerifyExpiresAt || '',
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

/** 본사 로그인 시: 1원인증 전체 이력(필터는 클라이언트) */
async function hqFullList(event) {
  try {
    const { data, names } = await getKycData(event);
    const items = [];
    const dataObj = data && typeof data === 'object' ? data : {};
    Object.keys(dataObj).forEach((sid) => {
      const list = Array.isArray(dataObj[sid]) ? dataObj[sid] : [];
      list.forEach((m) => {
        if (!m || !m.name) return;
        const st = m.accountVerifyStatus || 'none';
        if (st === 'none') return;
        items.push({
          storeId: sid,
          storeName: (names && names[sid]) ? names[sid] : sid,
          memberName: m.name,
          bankName: m.bankName || '',
          accountNumber: m.accountNumber || '',
          accountHolder: m.accountHolder || '',
          status: st,
          memberAccount: m.account || 'wait',
          depositCode4: m.depositCode4 ? String(m.depositCode4) : '',
          requestedAt: m.accountVerifyRequestedAt || '',
          completedAt: m.accountVerifyCompletedAt || '',
          cancelledAt: m.accountVerifyCancelledAt || '',
          cancelReason: m.accountVerifyCancelReason || '',
          codeSentByNickname: m.accountVerifyCodeSentByNickname || '',
          codeSentAt: m.accountVerifyCodeSentAt || '',
          expiresAt: m.accountVerifyExpiresAt || '',
          hqOneWonTransferConfirmedAt: m.hqOneWonTransferConfirmedAt || '',
        });
      });
    });
    items.sort((a, b) => String(b.requestedAt || '').localeCompare(String(a.requestedAt || '')));
    return json(200, { ok: true, items });
  } catch (err) {
    console.error('hqFullList', err);
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
      hqOneWonTransferConfirmedAt: '',
    };
    await setKycData(event, data, null);
    return json(200, { ok: true });
  } catch (err) {
    console.error('hqSetDepositCode', err);
    const help = getStorageErrorHelp();
    return json(500, { error: 'Storage error', message: (err.message || '') + (help ? '\n\n' + help : '') });
  }
}

async function hqCancelTransfer(event, body) {
  const session = verifyHqSessionFromEvent(event);
  const legacyOk = checkHqSecret(event);
  if (!session && !legacyOk) return json(403, { error: 'forbidden' });
  const storeId = String(body.storeId || '').trim();
  const memberName = String(body.memberName || '').trim();
  const reason = String(body.reason || '').trim();
  const ALLOW = new Set(['bank_maintenance', 'holder_mismatch', 'wrong_account']);
  if (!storeId || !memberName || !ALLOW.has(reason)) {
    return json(400, { error: 'storeId, memberName, reason required' });
  }
  try {
    const { data, list, idx } = await findMemberIndex(event, storeId, memberName);
    if (idx < 0) return json(404, { error: 'member not found' });
    const prev = list[idx];
    const st = prev.accountVerifyStatus || 'none';
    if (st !== 'pending' && st !== 'code_sent') {
      return json(400, { error: 'pending 또는 code_sent만 취소할 수 있습니다.', status: st });
    }
    list[idx] = {
      ...prev,
      accountVerifyStatus: 'cancelled',
      accountVerifyCancelReason: reason,
      accountVerifyCancelledAt: new Date().toISOString(),
      depositCode4: '',
      accountVerifyCodeSentAt: '',
      accountVerifyCodeSentByNickname: '',
      accountVerifyCodeSentById: '',
      accountVerifyExpiresAt: '',
      hqOneWonTransferConfirmedAt: '',
    };
    await setKycData(event, data, null);
    return json(200, { ok: true });
  } catch (err) {
    console.error('hqCancelTransfer', err);
    const help = getStorageErrorHelp();
    return json(500, { error: 'Storage error', message: (err.message || '') + (help ? '\n\n' + help : '') });
  }
}

/** 본사: 실제 1원 입금 후 회원에게 입금 알림(4자리·은행명)이 가도록 허용 */
async function hqConfirmOneWonTransfer(event, body) {
  const session = verifyHqSessionFromEvent(event);
  const legacyOk = checkHqSecret(event);
  if (!session && !legacyOk) return json(403, { error: 'forbidden' });
  const storeId = String(body.storeId || '').trim();
  const memberName = String(body.memberName || '').trim();
  if (!storeId || !memberName) {
    return json(400, { error: 'storeId, memberName required' });
  }
  try {
    const { data, list, idx } = await findMemberIndex(event, storeId, memberName);
    if (idx < 0) return json(404, { error: 'member not found' });
    const prev = list[idx];
    const st = prev.accountVerifyStatus || 'none';
    if (st !== 'code_sent' && st !== 'pending') {
      return json(400, { error: '입금 대기 건만 처리할 수 있습니다.', status: st });
    }
    const code4 = String(prev.depositCode4 || '').replace(/\D/g, '');
    if (code4.length !== 4) {
      return json(400, { error: '인증 번호 4자리가 없습니다.' });
    }
    if (prev.hqOneWonTransferConfirmedAt) {
      return json(200, { ok: true, already: true });
    }
    list[idx] = {
      ...prev,
      hqOneWonTransferConfirmedAt: new Date().toISOString(),
    };
    await setKycData(event, data, null);
    return json(200, { ok: true });
  } catch (err) {
    console.error('hqConfirmOneWonTransfer', err);
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
    const avs0 = prev.accountVerifyStatus || 'none';
    if (avs0 === 'cancelled') {
      return json(400, { error: '취소된 요청입니다.' });
    }
    if (avs0 !== 'code_sent') {
      return json(400, { error: '입금 코드가 아직 없습니다.' });
    }
    if (!useFixedAccountCodeMode() && String(prev.depositCode4) !== code4) {
      return json(200, { ok: true, match: false });
    }
    const wasComplete = prev.account === 'complete';
    const completedAt = prev.accountVerifyCompletedAt || new Date().toISOString();
    const now = new Date().toISOString();
    const completionCodeTtlSec = 10 * 60;
    const completionCodeExpiresAt = new Date(Date.now() + completionCodeTtlSec * 1000).toISOString();
    const completionAccountInfo = makeCompletionAccountInfo(prev);
    const codePayload = {
      user: {
        storeId,
        memberName,
        phone: String((prev && prev.phone) || '').replace(/\D/g, ''),
      },
      kycComplete: true,
      createdAt: now,
      accountInfo: completionAccountInfo,
    };
    const codeData = await issueCompletionCodeToUpstash(data, codePayload, completionCodeTtlSec);

    list[idx] = {
      ...prev,
      account: 'complete',
      accountVerifyStatus: 'complete',
      accountVerifyCompletedAt: completedAt,
      completionCodeHash: codeData.hash,
      completionCodeIssuedAt: now,
      completionCodeExpiresAt: completionCodeExpiresAt,
      completionCodeUsedAt: '',
      completionCodeAccountInfo: completionAccountInfo,
    };
    await setKycData(event, data, null);
    if (!wasComplete) {
      await incrementUsage(event, storeId, 'account');
      await incrementDailyKycComplete(event, storeId);
      const displayName = String((prev && prev.name) || memberName || '').trim();
      const phoneDigits = String((prev && prev.phone) || '').replace(/\D/g, '');
      void telegramNotify(telegramKycLine('account', displayName, phoneDigits));
    }
    return json(200, { ok: true, match: true, completionCode6: codeData.code, completionCodeExpiresAt });
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
    const session = verifyHqSessionFromEvent(event);
    if (session) {
      return hqFullList(event);
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
    if (action === 'hqCancelTransfer') return hqCancelTransfer(event, body);
    if (action === 'hqConfirmOneWonTransfer') return hqConfirmOneWonTransfer(event, body);
    if (action === 'memberVerifyCode') return memberVerifyCode(event, body);
    return json(400, { error: 'unknown action' });
  }

  return json(405, { error: 'Method not allowed' });
};
