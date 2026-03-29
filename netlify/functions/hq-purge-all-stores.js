const { verifyHqSessionFromEvent } = require('./hq-session');
const { purgeAllStoresData, getStorageErrorHelp } = require('./storage');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-HQ-Admin-Token',
};

const CONFIRM_PHRASE = '모든 가맹점 삭제';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: '' };
  }

  const admin = verifyHqSessionFromEvent(event);
  if (!admin) {
    return {
      statusCode: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  if (String(body.confirm || '').trim() !== CONFIRM_PHRASE) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'confirm required',
        message: `요청 본문에 confirm: "${CONFIRM_PHRASE}" 를 정확히 넣어 주세요.`,
      }),
    };
  }

  try {
    await purgeAllStoresData(event);
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, message: '모든 가맹점 및 연관 데이터가 초기화되었습니다.' }),
    };
  } catch (err) {
    console.error('hq-purge-all-stores', err);
    const help = getStorageErrorHelp();
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: err && err.message ? err.message : 'purge failed',
        help,
      }),
    };
  }
};
