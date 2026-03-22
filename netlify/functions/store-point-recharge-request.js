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

/** 가맹점 USDT 충전(입금) 신청 — 본사 지갑 입금 확인 후 포인트 반영용. kind=deposit 으로 기록 */
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
  const amt = normalizeUsdt(body.usdt != null ? body.usdt : body.amount);

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
      body: JSON.stringify({ error: 'usdt amount required' }),
    };
  }

  try {
    const map = { ...(await getStorePointsMap(event)) };
    const cur = map[storeId] || {};
    let bal = Number(cur.pointBalanceUsdt != null ? cur.pointBalanceUsdt : cur.pointBalance);
    if (!isFinite(bal)) bal = 0;
    bal = Math.round(bal * 2) / 2;

    const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : '';
    const historyId = genHistoryId();
    const hist = Array.isArray(cur.pointHistory) ? cur.pointHistory.slice() : [];
    hist.push({
      at: new Date().toISOString(),
      kind: 'deposit',
      amount: amt,
      historyId,
      status: '진행중',
      note: wallet || '가맹점 USDT 충전(입금)',
    });

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
        message: '충전 신청이 접수되었습니다. 본사 확인 후 포인트가 반영됩니다.',
        storeId,
        historyId,
        status: '진행중',
        pointBalanceUsdt: bal,
        pointBalance: bal,
        pointHistory: map[storeId].pointHistory,
      }),
    };
  } catch (err) {
    console.error('store-point-recharge-request error', err);
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
