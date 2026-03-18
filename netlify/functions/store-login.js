const { getKycData, verifyStorePassword, getSuspendedStores, getStorageErrorHelp } = require('./storage');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: '' };

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  const storeId = typeof body.storeId === 'string' ? body.storeId.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!storeId || !password) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'storeId and password required' }),
    };
  }

  try {
    const ok = await verifyStorePassword(event, storeId, password);
    if (!ok) {
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid ID or password' }),
      };
    }
    const suspendedMap = await getSuspendedStores(event);
    if (suspendedMap[storeId]) {
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: '이용정지된 가맹점입니다. 관리자에게 문의하세요.' }),
      };
    }
    const { names } = await getKycData(event);
    const namesObj = typeof names === 'object' && names !== null ? names : {};
    const storeName = (namesObj[storeId] !== undefined && namesObj[storeId] !== '') ? namesObj[storeId] : storeId;
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, storeId, storeName }),
    };
  } catch (err) {
    console.error('store-login error', err);
    const help = getStorageErrorHelp();
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server error', message: (err.message || '') + (help ? '\n\n' + help : '') }),
    };
  }
};
