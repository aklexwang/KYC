const {
  getStorePointsMap,
  setStorePointsMap,
  getStoreMinRechargeUsdt,
  getStorageErrorHelp,
} = require('./storage');

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
    const minRecharge = await getStoreMinRechargeUsdt(event);
    if (amt < minRecharge) {
      return {
        statusCode: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: `충전은 ${minRecharge} USDT 이상만 가능합니다.`,
        }),
      };
    }
    const map = { ...(await getStorePointsMap(event)) };
    const cur = map[storeId] || {};
    let bal = Number(cur.pointBalanceUsdt != null ? cur.pointBalanceUsdt : cur.pointBalance);
    if (!isFinite(bal)) bal = 0;
    bal = Math.round(bal * 2) / 2;

    const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : '';
    const hist = Array.isArray(cur.pointHistory) ? cur.pointHistory.slice() : [];
    const noteStr = wallet || '가맹점 USDT 충전(입금)';
    const now = Date.now();
    const dupWindowMs = 120000;
    const existingPending = [...hist].reverse().find((h) => {
      if (!h || h.kind !== 'deposit') return false;
      const st = h.status != null ? String(h.status).trim() : '';
      if (st !== '진행중' && st !== '처리중') return false;
      const ha = Number(h.amount);
      if (!isFinite(ha) || Math.round(ha * 2) / 2 !== amt) return false;
      const n = typeof h.note === 'string' ? h.note.trim() : '';
      if (n !== noteStr) return false;
      const t = h.at ? new Date(h.at).getTime() : 0;
      if (!t || now - t > dupWindowMs) return false;
      return true;
    });
    if (existingPending && existingPending.historyId) {
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          message: '동일한 충전 신청이 이미 접수되어 있습니다.',
          storeId,
          historyId: String(existingPending.historyId),
          status: '진행중',
          pointBalanceUsdt: bal,
          pointBalance: bal,
          pointHistory: hist,
          deduped: true,
        }),
      };
    }
    const historyId = genHistoryId();
    hist.push({
      at: new Date().toISOString(),
      kind: 'deposit',
      amount: amt,
      historyId,
      status: '진행중',
      note: noteStr,
    });

    map[storeId] = {
      pointBalanceUsdt: bal,
      pointHistory: hist,
    };
    await setStorePointsMap(event, map);
    const after = await getStorePointsMap(event);
    const curAfter = after[storeId] || {};
    const histAfter = Array.isArray(curAfter.pointHistory) ? curAfter.pointHistory : [];
    const persisted = histAfter.some((e) => e && String(e.historyId || '') === String(historyId));
    if (!persisted) {
      console.error('store-point-recharge-request persist verify failed', { storeId, historyId });
      return {
        statusCode: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'persist_failed',
          message: '충전 신청을 저장한 뒤 확인에 실패했습니다. 잠시 후 다시 시도해 주세요.',
        }),
      };
    }

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
