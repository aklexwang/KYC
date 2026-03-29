/**
 * POST { phoneNumber } → { used: boolean }
 * KYC 데이터에 문자 인증 완료된 동일 번호가 있거나, 전역 SMS 인증 맵에 있으면 used: true
 */

const { isPhoneSmsVerifiedGlobally, shouldApplyGlobalSmsDuplicateBlock } = require('./storage');

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
  if (phoneDigits.length < 9) {
    return json(400, { error: 'Invalid phone number' });
  }

  const storeId = typeof body.storeId === 'string' ? body.storeId.trim() : '';

  try {
    let used = false;
    if (await shouldApplyGlobalSmsDuplicateBlock(event, storeId)) {
      used = await isPhoneSmsVerifiedGlobally(event, phoneDigits);
    }
    return json(200, { used: !!used });
  } catch (e) {
    console.error('check-phone-used', e);
    return json(502, { error: 'Server error', used: false });
  }
};
