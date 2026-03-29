const crypto = require('crypto');
const { getKycData, setKycData, incrementUsage, getStorageErrorHelp, markPhoneSmsVerifiedGlobally } = require('./storage');
const { telegramNotify, telegramKycLine } = require('./_telegram-notify');

/** 1원 인증용 4자리 (0000–9999, 서버 자동 부여) */
function randomDepositCode4() {
  const n = crypto.randomInt(0, 10000);
  return String(n).padStart(4, '0');
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: '' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  const {
    name,
    storeId,
    sms,
    idDoc,
    account,
    phone,
    idDocImage,
    faceImage,
    bankName,
    accountNumber,
    accountHolder,
    requestAccountVerification,
  } = body;
  const sid = typeof storeId === 'string' ? storeId : '';
  const memberName = typeof name === 'string' ? name.trim() : '';
  if (!memberName) {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'name required' }) };
  }

  try {
    const { data } = await getKycData(event);
    const dataObj = typeof data === 'object' && data !== null ? data : {};
    const list = Array.isArray(dataObj[sid]) ? dataObj[sid] : [];
    const idx = list.findIndex((m) => m.name === memberName);
    const prev = idx >= 0
      ? list[idx]
      : { sms: 'wait', idDoc: 'wait', account: 'wait' };
    const keepPrevIfEmpty = (value, prevValue) => {
      if (typeof value !== 'string') return prevValue || '';
      const next = value.trim();
      return next !== '' ? next : (prevValue || '');
    };
    const phoneDigits = typeof phone === 'string' ? phone.replace(/\D/g, '') : '';
    const joinedAt =
      idx >= 0 && prev.joinedAt
        ? prev.joinedAt
        : new Date().toISOString();

    const smsNext = sms || prev.sms || 'wait';
    const idDocNext = idDoc || prev.idDoc || 'wait';
    let accountNext = typeof account === 'string' ? account : (prev.account || 'wait');
    /** 본사 1원 입금코드 확인 전에는 클라이언트가 account=complete 로 못 올림 */
    if (accountNext === 'complete' && prev.account !== 'complete') {
      const avs = prev.accountVerifyStatus || 'none';
      if (avs !== 'code_sent') accountNext = 'wait';
    }

    let accountVerifyStatus = prev.accountVerifyStatus || 'none';
    let depositCode4 = prev.depositCode4 || '';
    let accountVerifyRequestedAt = prev.accountVerifyRequestedAt || '';
    let accountVerifyExpiresAt = prev.accountVerifyExpiresAt || '';
    let accountVerifyCodeSentAt = prev.accountVerifyCodeSentAt || '';
    let accountVerifyCodeSentByNickname = prev.accountVerifyCodeSentByNickname || '';
    let accountVerifyCodeSentById = prev.accountVerifyCodeSentById || '';
    let resetAccountVerifyMeta = false;

    if (
      requestAccountVerification === true
      && smsNext === 'complete'
      && idDocNext === 'complete'
      && prev.account !== 'complete'
    ) {
      /** 신청 즉시 4자리 자동 생성 → 회원 화면에 표시, 회원이 동일 번호 입력 시 인증 완료 */
      accountVerifyStatus = 'code_sent';
      depositCode4 = randomDepositCode4();
      accountVerifyRequestedAt = new Date().toISOString();
      /** 회원 화면 1원 타이머(3분)과 동일하게 서버에 만료 시각 저장 */
      accountVerifyExpiresAt = new Date(Date.now() + 180 * 1000).toISOString();
      accountNext = 'wait';
      accountVerifyCodeSentAt = new Date().toISOString();
      accountVerifyCodeSentByNickname = '자동';
      accountVerifyCodeSentById = '';
      /** 본사 취소 후 재신청 시 이전 취소 메타만 제거 (코드는 위에서 새로 설정) */
      resetAccountVerifyMeta = true;
    }

    const row = {
      ...(idx >= 0 ? prev : {}),
      name: memberName,
      joinedAt,
      sms: smsNext,
      idDoc: idDocNext,
      account: accountNext,
      phone: phoneDigits !== '' ? phoneDigits : (prev.phone || ''),
      idDocImage: keepPrevIfEmpty(idDocImage, prev.idDocImage),
      faceImage: keepPrevIfEmpty(faceImage, prev.faceImage),
      bankName: keepPrevIfEmpty(bankName, prev.bankName),
      accountNumber: keepPrevIfEmpty(accountNumber, prev.accountNumber),
      accountHolder: keepPrevIfEmpty(accountHolder, prev.accountHolder),
      accountVerifyStatus,
      depositCode4,
      accountVerifyRequestedAt,
      accountVerifyExpiresAt,
      accountVerifyCodeSentAt,
      accountVerifyCodeSentByNickname,
      accountVerifyCodeSentById,
      ...(resetAccountVerifyMeta
        ? {
            accountVerifyCancelReason: '',
            accountVerifyCancelledAt: '',
            accountVerifyCompletedAt: '',
          }
        : {}),
    };
    if (idx >= 0) {
      list[idx] = row;
    } else {
      list.push(row);
    }
    dataObj[sid] = list;
    await setKycData(event, dataObj, null);
    const notifyName = row.name || memberName;
    if (row.sms === 'complete' && prev.sms !== 'complete' && row.phone) {
      await markPhoneSmsVerifiedGlobally(event, row.phone);
    }
    if (row.sms === 'complete' && prev.sms !== 'complete') {
      void telegramNotify(telegramKycLine('sms', notifyName));
    }
    if (row.idDoc === 'complete' && prev.idDoc !== 'complete') {
      void telegramNotify(telegramKycLine('idDoc', notifyName));
    }
    if (sid) {
      if (row.sms === 'complete' && prev.sms !== 'complete') await incrementUsage(event, sid, 'sms');
      if (row.idDoc === 'complete' && prev.idDoc !== 'complete') await incrementUsage(event, sid, 'idDoc');
      /** 계좌 건수는 /api/account-verify (memberVerifyCode) 에서만 증가 */
    }
  } catch (err) {
    console.error('kyc save error', err);
    const help = getStorageErrorHelp();
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Storage error', message: (err.message || '') + (help ? '\n\n' + help : '') }),
    };
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  };
};
