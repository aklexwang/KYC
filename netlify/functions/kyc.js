const { getKycData, setKycData, incrementUsage, getStorageErrorHelp } = require('./storage');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: '' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  const { name, storeId, sms, idDoc, account } = body;
  const sid = typeof storeId === 'string' ? storeId : '';
  const memberName = typeof name === 'string' ? name.trim() : '';
  if (!memberName) {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'name required' }) };
  }

  try {
    const { data } = await getKycData(event);
    const dataObj = typeof data === 'object' && data !== null ? data : {};
    const list = Array.isArray(dataObj[sid]) ? dataObj[sid] : [];
    const idx = list.findIndex((m) => m.name === memberName);
    const prev = idx >= 0 ? list[idx] : { sms: 'wait', idDoc: 'wait', account: 'wait' };
    const row = { name: memberName, sms: sms || 'wait', idDoc: idDoc || 'wait', account: account || 'wait' };
    if (idx >= 0) {
      list[idx] = row;
    } else {
      list.push(row);
    }
    dataObj[sid] = list;
    await setKycData(event, dataObj, null);
    if (sid) {
      if (row.sms === 'complete' && prev.sms !== 'complete') await incrementUsage(event, sid, 'sms');
      if (row.idDoc === 'complete' && prev.idDoc !== 'complete') await incrementUsage(event, sid, 'idDoc');
      if (row.account === 'complete' && prev.account !== 'complete') await incrementUsage(event, sid, 'account');
    }
  } catch (err) {
    console.error('kyc save error', err);
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
    body: JSON.stringify({ ok: true }),
  };
};
