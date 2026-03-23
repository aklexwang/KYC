const { getWalletIssuance, setWalletIssuance, getStorageErrorHelp } = require('./storage');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  try {
    if (event.httpMethod === 'GET') {
      const qs = event.queryStringParameters || {};
      const storeId = typeof qs.storeId === 'string' ? qs.storeId.trim() : '';
      if (!storeId) {
        return {
          statusCode: 400,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'storeId required' }),
        };
      }
      const issuance = await getWalletIssuance(event);
      const rec = issuance.byStore[storeId];
      if (!rec) {
        return {
          statusCode: 200,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ok: true, status: 'idle' }),
        };
      }
      if (rec.status === 'pending') {
        return {
          statusCode: 200,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ok: true, status: 'pending', requestedAt: rec.requestedAt || null }),
        };
      }
      if (rec.status === 'completed') {
        const w = typeof rec.wallet === 'string' ? rec.wallet.trim() : '';
        return {
          statusCode: 200,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ok: true,
            status: 'completed',
            wallet: w,
            completedAt: rec.completedAt || null,
          }),
        };
      }
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, status: 'idle' }),
      };
    }

    if (event.httpMethod === 'POST') {
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
      const storeId = typeof body.storeId === 'string' ? body.storeId.trim() : '';
      const storeName = typeof body.storeName === 'string' ? body.storeName.trim() : '';
      if (!storeId) {
        return {
          statusCode: 400,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'storeId required' }),
        };
      }
      const issuance = await getWalletIssuance(event);
      const byStore = { ...issuance.byStore };
      const cur = byStore[storeId];
      if (cur && cur.status === 'pending') {
        return {
          statusCode: 200,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ok: true,
            status: 'pending',
            message: '이미 주소 발급 요청이 접수되었습니다.',
            requestedAt: cur.requestedAt || null,
          }),
        };
      }
      byStore[storeId] = {
        storeId,
        storeName: storeName || (cur && cur.storeName) || storeId,
        status: 'pending',
        wallet: '',
        requestedAt: new Date().toISOString(),
        completedAt: '',
      };
      await setWalletIssuance(event, { byStore });
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          status: 'pending',
          message: '주소 발급 요청이 접수되었습니다.',
          requestedAt: byStore[storeId].requestedAt,
        }),
      };
    }

    return { statusCode: 405, headers: CORS, body: '' };
  } catch (err) {
    console.error('store-wallet-issuance error', err);
    const help = getStorageErrorHelp();
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Storage error',
        message: (err.message || '') + (help ? `\n\n${help}` : ''),
      }),
    };
  }
};
