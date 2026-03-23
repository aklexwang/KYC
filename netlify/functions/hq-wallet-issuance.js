const { verifyHqSessionFromEvent } = require('./hq-session');
const { getWalletIssuance, setWalletIssuance, getStorageErrorHelp } = require('./storage');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-HQ-Admin-Token',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const admin = verifyHqSessionFromEvent(event);
  if (!admin) {
    return {
      statusCode: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  try {
    if (event.httpMethod === 'GET') {
      const issuance = await getWalletIssuance(event);
      const byStore = issuance.byStore || {};
      const pending = Object.keys(byStore)
        .map((k) => byStore[k])
        .filter((r) => r && r.status === 'pending')
        .map((r) => ({
          storeId: r.storeId,
          storeName: r.storeName || r.storeId,
          requestedAt: r.requestedAt || null,
        }));
      const storedHist = Array.isArray(issuance.completionHistory) ? issuance.completionHistory : [];
      const legacyRows = Object.keys(byStore)
        .map((k) => byStore[k])
        .filter((r) => r && r.status === 'completed' && typeof r.wallet === 'string' && r.wallet.trim())
        .map((r) => ({
          storeId: r.storeId,
          storeName: r.storeName || r.storeId,
          wallet: r.wallet.trim(),
          completedAt: r.completedAt || '',
          requestedAt: r.requestedAt || null,
          issuedByNickname: '기록 없음',
          issuedByAdminId: '',
          issuanceOutcome: 'completed',
        }));
      const mergeKey = (row) => {
        let out = 'completed';
        if (row.issuanceOutcome === 'cancelled') out = 'cancelled';
        else if (row.issuanceOutcome === 'rejected') out = 'rejected';
        return `${row.storeId || ''}|${out}|${row.completedAt || ''}|${String(row.wallet || '').trim()}`;
      };
      const mergedMap = new Map();
      legacyRows.forEach((row) => mergedMap.set(mergeKey(row), row));
      storedHist.forEach((row) => {
        if (!row || typeof row !== 'object') return;
        const k = mergeKey(row);
        mergedMap.set(k, { ...mergedMap.get(k), ...row, wallet: String(row.wallet || '').trim() });
      });
      let completedHistory = Array.from(mergedMap.values()).filter((r) => {
        if (r && r.issuanceOutcome === 'cancelled') return true;
        if (r && r.issuanceOutcome === 'rejected') return true;
        return !!(r && typeof r.wallet === 'string' && r.wallet.trim());
      });
      completedHistory.sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          pending,
          count: pending.length,
          completedHistory,
        }),
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
      const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : '';
      const action = typeof body.action === 'string' ? body.action.trim() : '';
      if (!storeId) {
        return {
          statusCode: 400,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'storeId required' }),
        };
      }

      if (action === 'rejectPending') {
        const issuanceRej = await getWalletIssuance(event);
        const byStoreRej = { ...issuanceRej.byStore };
        const recRej = byStoreRej[storeId];
        if (!recRej || recRej.status !== 'pending') {
          return {
            statusCode: 400,
            headers: { ...CORS, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: '해당 가맹점의 대기 중인 요청이 없습니다.' }),
          };
        }
        const rejectedAt = new Date().toISOString();
        byStoreRej[storeId] = {
          ...recRej,
          status: 'rejected',
          wallet: '',
          rejectedAt,
          completedAt: '',
        };
        const prevHistRej = Array.isArray(issuanceRej.completionHistory) ? issuanceRej.completionHistory : [];
        const historyEntryRej = {
          storeId,
          storeName: recRej.storeName || storeId,
          wallet: '',
          completedAt: rejectedAt,
          requestedAt: recRej.requestedAt || null,
          issuedByNickname: admin.nickname || admin.id || '본사',
          issuedByAdminId: admin.id || '',
          issuanceOutcome: 'rejected',
        };
        const completionHistoryRej = [...prevHistRej, historyEntryRej].slice(-500);
        await setWalletIssuance(event, { byStore: byStoreRej, completionHistory: completionHistoryRej });
        return {
          statusCode: 200,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ok: true,
            storeId,
            message: '발급 요청을 거부 처리했습니다.',
          }),
        };
      }

      if (!wallet || wallet.length < 26) {
        return {
          statusCode: 400,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: '유효한 지갑 주소를 입력해 주세요.' }),
        };
      }
      const issuance = await getWalletIssuance(event);
      const byStore = { ...issuance.byStore };
      const rec = byStore[storeId];
      if (!rec || rec.status !== 'pending') {
        return {
          statusCode: 400,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: '해당 가맹점의 대기 중인 요청이 없습니다.' }),
        };
      }
      const completedAt = new Date().toISOString();
      byStore[storeId] = {
        ...rec,
        status: 'completed',
        wallet,
        completedAt,
      };
      const prevHist = Array.isArray(issuance.completionHistory) ? issuance.completionHistory : [];
      const historyEntry = {
        storeId,
        storeName: rec.storeName || storeId,
        wallet,
        completedAt,
        requestedAt: rec.requestedAt || null,
        issuedByNickname: admin.nickname || admin.id || '',
        issuedByAdminId: admin.id || '',
        issuanceOutcome: 'completed',
      };
      const completionHistory = [...prevHist, historyEntry].slice(-500);
      await setWalletIssuance(event, { byStore, completionHistory });
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          storeId,
          message: '지갑 주소가 등록되었습니다.',
        }),
      };
    }

    return { statusCode: 405, headers: CORS, body: '' };
  } catch (err) {
    console.error('hq-wallet-issuance error', err);
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
