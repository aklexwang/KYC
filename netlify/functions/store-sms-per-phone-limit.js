const {
  setStoreSmsPerPhoneLimitForStore,
  getStoreSmsPerPhoneLimitForStore,
  getStorageErrorHelp,
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
  if (!storeId) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'storeId required' }),
    };
  }

  try {
    const raw = body.smsPerPhoneLimit != null ? body.smsPerPhoneLimit : body.limit;
    await setStoreSmsPerPhoneLimitForStore(event, storeId, raw);
    const smsPerPhoneLimit = await getStoreSmsPerPhoneLimitForStore(event, storeId);
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, storeId, smsPerPhoneLimit }),
    };
  } catch (err) {
    console.error('store-sms-per-phone-limit error', err);
    const help = getStorageErrorHelp();
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server error', message: (err.message || '') + (help ? '\n\n' + help : '') }),
    };
  }
};
