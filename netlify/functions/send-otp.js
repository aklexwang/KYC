/**
 * Didit Standalone Phone API — POST /v3/phone/send/
 * https://docs.didit.me/standalone-apis/phone-send
 *
 * Env: DIDIT_API_KEY (x-api-key). Optional: DIDIT_SMS_MOCK=1 for local/demo without credits.
 */

const {
  isPhoneSmsVerifiedGlobally,
  shouldApplyGlobalSmsDuplicateBlock,
  isSmsSendAllowedForStorePhone,
  incrementSmsSendCountForStorePhone,
} = require('./storage');

const DIDIT_PHONE_SEND = 'https://verification.didit.me/v3/phone/send/';

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

/** 한국 휴대폰 숫자만 → E.164 (+82…) */
function krDigitsToE164(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('010')) {
    return `+82${d.slice(1)}`;
  }
  if (d.length === 10 && d.startsWith('10')) {
    return `+82${d}`;
  }
  if (d.length >= 9 && d.length <= 11 && d.startsWith('0')) {
    return `+82${d.slice(1)}`;
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const phoneDigits = String(body.phoneNumber || '').replace(/\D/g, '');
  const e164 = krDigitsToE164(phoneDigits);
  if (!e164) {
    return json(400, { error: 'Invalid phone number' });
  }

  const storeId = typeof body.storeId === 'string' ? body.storeId.trim() : '';
  try {
    const quota = await isSmsSendAllowedForStorePhone(event, storeId, phoneDigits);
    if (!quota.ok) {
      return json(400, {
        error: 'sms_send_limit_exceeded',
        message: `이 가맹점에서는 동일 번호로 인증 문자를 최대 ${quota.limit}번까지 받을 수 있습니다. (이미 ${quota.used}번 발송됨)`,
        limit: quota.limit,
        used: quota.used,
      });
    }
  } catch (e) {
    console.error('send-otp isSmsSendAllowedForStorePhone', e);
  }

  try {
    if (await shouldApplyGlobalSmsDuplicateBlock(event, storeId)) {
      if (await isPhoneSmsVerifiedGlobally(event, phoneDigits)) {
        return json(400, {
          error: 'phone_already_sms_verified',
          message: '이 휴대폰 번호는 이미 문자 인증이 완료되었습니다. 다른 번호로 진행해 주세요.',
        });
      }
    }
  } catch (e) {
    console.error('send-otp isPhoneSmsVerifiedGlobally', e);
  }

  const apiKey = process.env.DIDIT_API_KEY;
  const mock = process.env.DIDIT_SMS_MOCK === '1' || process.env.DIDIT_SMS_MOCK === 'true';

  if (!apiKey) {
    if (mock) {
      await incrementSmsSendCountForStorePhone(event, storeId, phoneDigits);
      return json(200, {
        ok: true,
        mock: true,
        code: '123456',
        message: 'DIDIT_SMS_MOCK: test code 123456',
      });
    }
    return json(503, {
      error: 'not_configured',
      message: 'Set DIDIT_API_KEY in Netlify environment variables (or DIDIT_SMS_MOCK=1 for demo).',
    });
  }

  try {
    const res = await fetch(DIDIT_PHONE_SEND, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        phone_number: e164,
        options: {
          preferred_channel: 'sms',
          code_size: 6,
          locale: 'ko-KR',
        },
        vendor_data: typeof body.vendorData === 'string' ? body.vendorData.slice(0, 512) : undefined,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = data.detail || data.error || res.statusText || 'Didit request failed';
      return json(res.status === 401 || res.status === 403 ? res.status : 502, {
        error: 'didit_error',
        message: typeof msg === 'string' ? msg : JSON.stringify(msg),
        status: res.status,
      });
    }

    if (data.status === 'Success' || data.status === 'Retry') {
      await incrementSmsSendCountForStorePhone(event, storeId, phoneDigits);
      return json(200, { ok: true, requestId: data.request_id || null });
    }

    if (data.status === 'Blocked') {
      return json(400, {
        error: 'blocked',
        reason: data.reason || null,
        message: '번호가 차단되었거나 발송할 수 없습니다.',
      });
    }

    return json(400, {
      error: 'send_failed',
      status: data.status,
      reason: data.reason || null,
      message: 'Didit did not accept the send request.',
    });
  } catch (err) {
    console.error('send-otp', err);
    return json(502, { error: 'upstream', message: err.message || 'Network error' });
  }
};
