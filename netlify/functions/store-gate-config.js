const { getStoreGateMinUsdt, setStoreGateMinUsdt, getStorageErrorHelp } = require('./storage');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: '' };
  }

  try {
    if (event.httpMethod === 'GET') {
      const minUsdtForStoreUse = await getStoreGateMinUsdt(event);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', ...CORS },
        body: JSON.stringify({ minUsdtForStoreUse }),
      };
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return {
        statusCode: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid JSON' }),
      };
    }
    const raw = body.minUsdtForStoreUse != null ? body.minUsdtForStoreUse : body.min;
    const minUsdtForStoreUse = await setStoreGateMinUsdt(event, raw);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...CORS },
      body: JSON.stringify({ ok: true, minUsdtForStoreUse }),
    };
  } catch (err) {
    console.error('store-gate-config error', err);
    const help = getStorageErrorHelp();
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Storage error', message: (err.message || '') + (help ? `\n\n${help}` : '') }),
    };
  }
};
