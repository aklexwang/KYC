const { getStorePointsMap, setStorePointsMap, getStorageErrorHelp } = require('./storage');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function normalizeUsdt(n) {
  const x = typeof n === 'string' ? parseFloat(String(n).replace(/,/g, '')) : Number(n);
  if (!isFinite(x) || x <= 0) return null;
  return Math.round(x * 2) / 2;
}

function genHistoryId() {
  return `ph_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

exports.handler = async (event) => {
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
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  const storeId = typeof body.storeId === 'string' ? body.storeId.trim() : '';
  const kind = body.kind === 'deduct' ? 'deduct' : 'grant';
  const amt = normalizeUsdt(body.amount);
  const noteRaw = typeof body.note === 'string' ? body.note.trim() : '';

  if (!storeId) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'storeId required' }),
    };
  }
  if (amt == null) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'amount required' }),
    };
  }

  try {
    const map = { ...(await getStorePointsMap(event)) };
    const cur = map[storeId] || {};
    let bal = Number(cur.pointBalanceUsdt != null ? cur.pointBalanceUsdt : cur.pointBalance);
    if (!isFinite(bal)) bal = 0;
    bal = Math.round(bal * 2) / 2;
    const nextBal = kind === 'grant' ? bal + amt : bal - amt;
    if (nextBal < 0) {
      return {
        statusCode: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Insufficient balance' }),
      };
    }
    const hist = Array.isArray(cur.pointHistory) ? cur.pointHistory.slice() : [];
    const entry = {
      at: new Date().toISOString(),
      kind,
      amount: amt,
      historyId: genHistoryId(),
      status: '완료',
    };
    if (noteRaw) entry.note = noteRaw;
    hist.push(entry);
    const rounded = Math.round(nextBal * 2) / 2;
    map[storeId] = {
      pointBalanceUsdt: rounded,
      pointHistory: hist,
    };
    await setStorePointsMap(event, map);
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        storeId,
        pointBalanceUsdt: rounded,
        pointBalance: rounded,
        pointHistory: map[storeId].pointHistory,
      }),
    };
  } catch (err) {
    console.error('store-points error', err);
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
