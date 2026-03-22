const { getStorePointsMap, setStorePointsMap, getStorageErrorHelp } = require('./storage');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function isPendingStatus(s) {
  const t = s != null ? String(s).trim() : '';
  return t === '진행중' || t === '처리중';
}

/** 가맹점: 충전 건 상태 조회 (폴링) */
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  if (event.httpMethod === 'GET') {
    const params = event.queryStringParameters || {};
    const storeId = typeof params.storeId === 'string' ? params.storeId.trim() : '';
    const historyId = typeof params.historyId === 'string' ? params.historyId.trim() : '';
    if (!storeId || !historyId) {
      return {
        statusCode: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'storeId and historyId required' }),
      };
    }
    try {
      const map = await getStorePointsMap(event);
      const cur = map[storeId] || {};
      const hist = Array.isArray(cur.pointHistory) ? cur.pointHistory : [];
      const entry = hist.find((e) => e && String(e.historyId || '') === historyId);
      if (!entry) {
        return {
          statusCode: 404,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'not_found' }),
        };
      }
      const st = entry.status != null ? String(entry.status).trim() : '완료';
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          storeId,
          historyId,
          status: st,
          amount: entry.amount != null ? entry.amount : null,
          kind: entry.kind || null,
        }),
      };
    } catch (err) {
      console.error('store-point-recharge-resolve GET error', err);
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
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: '' };
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

  const storeId = typeof body.storeId === 'string' ? body.storeId.trim() : '';
  const historyId = typeof body.historyId === 'string' ? body.historyId.trim() : '';
  const decision = typeof body.decision === 'string' ? body.decision.trim().toLowerCase() : '';

  if (!storeId || !historyId) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'storeId and historyId required' }),
    };
  }
  if (decision !== 'complete' && decision !== 'cancel') {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'decision must be complete or cancel' }),
    };
  }

  try {
    const map = { ...(await getStorePointsMap(event)) };
    const cur = map[storeId] || {};
    let bal = Number(cur.pointBalanceUsdt != null ? cur.pointBalanceUsdt : cur.pointBalance);
    if (!isFinite(bal)) bal = 0;
    bal = Math.round(bal * 2) / 2;
    const hist = Array.isArray(cur.pointHistory) ? cur.pointHistory.slice() : [];
    const idx = hist.findIndex((e) => e && String(e.historyId || '') === historyId);
    if (idx === -1) {
      return {
        statusCode: 404,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'history entry not found' }),
      };
    }
    const entry = hist[idx];
    if (entry.kind !== 'deposit') {
      return {
        statusCode: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'not a deposit request' }),
      };
    }
    if (!isPendingStatus(entry.status)) {
      return {
        statusCode: 409,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'entry not pending', status: entry.status }),
      };
    }

    const amt = typeof entry.amount === 'string' ? parseFloat(String(entry.amount).replace(/,/g, '')) : Number(entry.amount);
    const amountOk = isFinite(amt) && amt > 0 ? Math.round(amt * 2) / 2 : null;
    if (amountOk == null) {
      return {
        statusCode: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'invalid amount on entry' }),
      };
    }

    if (decision === 'cancel') {
      entry.status = '취소';
      hist[idx] = entry;
    } else {
      const nextBal = Math.round((bal + amountOk) * 2) / 2;
      entry.status = '완료';
      hist[idx] = entry;
      bal = nextBal;
    }

    map[storeId] = {
      pointBalanceUsdt: bal,
      pointHistory: hist,
    };
    await setStorePointsMap(event, map);

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        storeId,
        historyId,
        decision,
        pointBalanceUsdt: bal,
        pointBalance: bal,
        pointHistory: map[storeId].pointHistory,
      }),
    };
  } catch (err) {
    console.error('store-point-recharge-resolve POST error', err);
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
