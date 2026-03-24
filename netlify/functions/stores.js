const {
  getKycData,
  getUsagePrices,
  getUsageCounts,
  getStorePrices,
  getSuspendedStores,
  getStorePointsMap,
  getStoreAllowedIpsMap,
  getStorageErrorHelp,
} = require('./storage');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: '' };

  const qs = event.queryStringParameters || {};
  const onlyStoreId = typeof qs.storeId === 'string' ? qs.storeId.trim() : '';

  try {
    const [kycResult, globalPrices, counts, storePricesMap, suspendedMap, pointsMap, allowedIpsMap] = await Promise.all([
      getKycData(event),
      getUsagePrices(event).catch(() => ({ sms: 100, idDoc: 200, account: 150, integrated: 0 })),
      getUsageCounts(event).catch(() => ({})),
      getStorePrices(event).catch(() => ({})),
      getSuspendedStores(event).catch(() => ({})),
      getStorePointsMap(event).catch(() => ({})),
      getStoreAllowedIpsMap(event).catch(() => ({})),
    ]);
    const pointsByStore = typeof pointsMap === 'object' && pointsMap !== null ? pointsMap : {};
    const ipsByStore = typeof allowedIpsMap === 'object' && allowedIpsMap !== null ? allowedIpsMap : {};
    const { data, names } = kycResult;
    const dataObj = typeof data === 'object' && data !== null ? data : {};
    const namesObj = typeof names === 'object' && names !== null ? names : {};
    const isKycComplete = (m) => m.sms === 'complete' && m.idDoc === 'complete' && m.account === 'complete';
    const storeEntries = Object.entries(dataObj).filter(([id]) => {
      if (!onlyStoreId) return true;
      return id === onlyStoreId;
    });
    const stores = storeEntries.map(([id, members]) => {
      const prices = { ...globalPrices, ...(storePricesMap[id] || {}) };
      const c = counts[id] || { sms: 0, idDoc: 0, account: 0 };
      const memberList = Array.isArray(members) ? members : [];
      const usage = {
        sms: { count: c.sms || 0, amount: (c.sms || 0) * (prices.sms || 0) },
        idDoc: { count: c.idDoc || 0, amount: (c.idDoc || 0) * (prices.idDoc || 0) },
        account: { count: c.account || 0, amount: (c.account || 0) * (prices.account || 0) },
      };
      const completedCount = memberList.filter(isKycComplete).length;
      const totalAmount = (prices.integrated > 0)
        ? completedCount * Number(prices.integrated)
        : usage.sms.amount + usage.idDoc.amount + usage.account.amount;
      const pt = pointsByStore[id] || {};
      const pbRaw = pt.pointBalanceUsdt != null ? pt.pointBalanceUsdt : pt.pointBalance;
      const pb = pbRaw != null && !isNaN(Number(pbRaw)) ? Math.round(Number(pbRaw) * 2) / 2 : 0;
      const ph = Array.isArray(pt.pointHistory) ? pt.pointHistory : [];
      const allowedIps = Array.isArray(ipsByStore[id]) ? ipsByStore[id] : [];
      return {
        // 실제 저장 키(빈 문자열 = 가맹점 미지정). 삭제·단가 API와 동일해야 함.
        id,
        name: (namesObj[id] !== undefined && namesObj[id] !== '') ? namesObj[id] : (id || '미지정'),
        members: Array.isArray(members) ? members : [],
        usage,
        totalAmount,
        prices: { sms: prices.sms, idDoc: prices.idDoc, account: prices.account, integrated: prices.integrated || 0 },
        suspended: !!suspendedMap[id],
        pointBalanceUsdt: pb,
        pointBalance: pb,
        pointHistory: ph,
        allowedIps,
      };
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      // 화면(admin-headquarters.html)이 data.prices를 사용합니다(전역 사용 단가).
      body: JSON.stringify({ stores, prices: globalPrices }),
    };
  } catch (err) {
    console.error('stores error', err);
    const help = getStorageErrorHelp();
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Storage error', message: (err.message || '') + (help ? '\n\n' + help : '') }),
    };
  }
};
