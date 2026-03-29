const { getKycBlacklistEntries, appendKycBlacklistEntry, getStorageErrorHelp } = require('./storage');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

  if (event.httpMethod === 'GET') {
    try {
      const entries = await getKycBlacklistEntries(event);
      return json(200, { entries });
    } catch (err) {
      console.error('kyc-blacklist GET', err);
      const help = getStorageErrorHelp();
      return json(500, {
        error: 'Server error',
        message: (err.message || '') + (help ? `\n\n${help}` : ''),
        entries: [],
      });
    }
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Invalid JSON' });
  }

  const phoneDigits = String(body.phone || '').replace(/\D/g, '');
  if (phoneDigits.length < 9) {
    return json(400, { error: 'phone required' });
  }

  try {
    const entry = await appendKycBlacklistEntry(event, {
      storeId: body.storeId,
      storeName: body.storeName,
      carrier: body.carrier,
      name: body.name,
      ssn: body.ssn,
      phone: phoneDigits,
      reason: body.reason || 'phone_already_used',
    });
    return json(200, { ok: true, id: entry.id });
  } catch (err) {
    console.error('kyc-blacklist POST', err);
    const help = getStorageErrorHelp();
    return json(500, { error: 'Server error', message: (err.message || '') + (help ? `\n\n${help}` : '') });
  }
};
