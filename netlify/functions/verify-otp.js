/**
 * Didit Standalone Phone API — POST /v3/phone/check/
 * https://docs.didit.me/standalone-apis/phone-check
 *
 * Env: DIDIT_API_KEY. Optional: DIDIT_SMS_MOCK (with send-otp mock, code 123456 passes).
 */

const { markPhoneSmsVerifiedGlobally } = require('./storage');

const DIDIT_PHONE_CHECK = 'https://verification.didit.me/v3/phone/check/';

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
  const code = String(body.code || '').replace(/\D/g, '');

  if (!e164 || !code || code.length < 4 || code.length > 8) {
    return json(400, { error: 'phoneNumber and code required', success: false });
  }

  const apiKey = process.env.DIDIT_API_KEY;
  const mock = process.env.DIDIT_SMS_MOCK === '1' || process.env.DIDIT_SMS_MOCK === 'true';

  if (!apiKey) {
    if (mock && code === '123456') {
      await markPhoneSmsVerifiedGlobally(event, phoneDigits);
      return json(200, { success: true, mock: true });
    }
    if (mock) {
      return json(200, { success: false, mock: true, message: 'Wrong code (mock expects 123456)' });
    }
    return json(503, {
      error: 'not_configured',
      message: 'Set DIDIT_API_KEY (or DIDIT_SMS_MOCK=1 and use code 123456).',
    });
  }

  try {
    const res = await fetch(DIDIT_PHONE_CHECK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      // DECLINE은 번호가 일시적으로 VoIP/가상/중복으로 분류될 때 올바른 코드도 거절될 수 있어 기본값(NO_ACTION)과 동일하게 둡니다.
      body: JSON.stringify({
        phone_number: e164,
        code,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 404) {
        return json(200, { success: false, message: data.detail || 'Code expired or not found' });
      }
      const msg = data.detail || data.error || res.statusText;
      return json(res.status === 401 || res.status === 403 ? res.status : 502, {
        success: false,
        error: 'didit_error',
        message: typeof msg === 'string' ? msg : JSON.stringify(msg),
      });
    }

    const approved = String(data.status || '').toLowerCase() === 'approved';
    if (approved) {
      await markPhoneSmsVerifiedGlobally(event, phoneDigits);
    }
    return json(200, {
      success: approved,
      requestId: data.request_id || null,
      message:
        data.message ||
        data.detail ||
        (approved ? null : data.status) ||
        null,
    });
  } catch (err) {
    console.error('verify-otp', err);
    return json(502, { success: false, error: 'upstream', message: err.message || 'Network error' });
  }
};
