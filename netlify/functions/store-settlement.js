/**
 * 가맹점별 일자·수수료 통계 (본사/가맹점 어드민용).
 * 일별 집계 저장소가 없으면 rows는 비어 있을 수 있음 — 가맹점은 본인 store 쿼리만 허용.
 */
const { getStorageErrorHelp } = require('./storage');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const q = event.queryStringParameters || {};
  const store = typeof q.store === 'string' ? q.store.trim() : '';
  if (!store) {
    return json(400, { error: 'store query required' });
  }

  try {
    return json(200, { ok: true, storeId: store, rows: [] });
  } catch (err) {
    console.error('store-settlement', err);
    const help = getStorageErrorHelp();
    return json(500, { error: 'Storage error', message: (err.message || '') + (help ? '\n\n' + help : '') });
  }
};
