const { deleteStore, getKycData, getStorageErrorHelp } = require('./storage');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: '' };

  // Netlify Blobs: 배포 환경에서 컨텍스트를 요청 직후 연결
  try {
    const { connectLambda } = require('@netlify/blobs');
    connectLambda(event);
  } catch (e) {}

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  const storeId = typeof body.storeId === 'string' ? body.storeId.trim() : '';
  if (!storeId) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'storeId required' }),
    };
  }

  try {
    await deleteStore(event, storeId);
    await new Promise(function (r) { setTimeout(r, 200); });
    const after = await getKycData(event);
    if (Object.prototype.hasOwnProperty.call(after.data || {}, storeId)) {
      return {
        statusCode: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: '삭제가 저장소에 반영되지 않았습니다.',
          message: '잠시 후 다시 시도하거나, Netlify 대시보드에서 Blobs/Upstash 환경 변수가 설정되었는지 확인해 주세요.',
        }),
      };
    }
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, storeId }),
    };
  } catch (err) {
    console.error('store-delete error', err);
    const help = getStorageErrorHelp();
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server error', message: (err.message || '') + (help ? '\n\n' + help : '') }),
    };
  }
};
