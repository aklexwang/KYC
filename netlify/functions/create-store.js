const {
  getKycData,
  setKycData,
  setStorePassword,
  getStorageErrorHelp,
  setStoreAllowedIpsForStore,
  normalizeAllowedIpsInput,
  setStoreSmsPerPhoneLimitForStore,
} = require('./storage');

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
  const storeName = typeof body.storeName === 'string' ? body.storeName.trim() : storeId || '미지정';
  const password = typeof body.password === 'string' ? body.password.trim() : '';
  if (!storeId) {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'storeId required' }) };
  }
  if (!password) {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'password required' }) };
  }

  try {
    const { data, names } = await getKycData(event);
    const dataObj = typeof data === 'object' && data !== null ? data : {};
    const namesObj = typeof names === 'object' && names !== null ? names : {};
    if (!Array.isArray(dataObj[storeId])) dataObj[storeId] = [];
    namesObj[storeId] = storeName;
    await setKycData(event, dataObj, namesObj);
    await setStorePassword(event, storeId, password);
    const allowedIps = normalizeAllowedIpsInput(body.allowedIps != null ? body.allowedIps : body.whitelistIp);
    await setStoreAllowedIpsForStore(event, storeId, allowedIps);
    await setStoreSmsPerPhoneLimitForStore(
      event,
      storeId,
      body.smsPerPhoneLimit != null ? body.smsPerPhoneLimit : body.smsPerPhone,
    );
  } catch (err) {
    console.error('create-store error', err);
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
    body: JSON.stringify({ ok: true, storeId, storeName }),
  };
};
