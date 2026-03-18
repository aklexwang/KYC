const { getKycData, getUsagePrices, getUsageCounts, getStorePrices, getSuspendedStores, getStorageErrorHelp } = require('./storage');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: '' };

  try {
    const [kycResult, globalPrices, counts, storePricesMap, suspendedMap] = await Promise.all([
      getKycData(event),
      getUsagePrices(event).catch(() => ({ sms: 100, idDoc: 200, account: 150, integrated: 0 })),
      getUsageCounts(event).catch(() => ({})),
      getStorePrices(event).catch(() => ({})),
      getSuspendedStores(event).catch(() => ({})),
    ]);
    const { data, names } = kycResult;
    const dataObj = typeof data === 'object' && data !== null ? data : {};
    const namesObj = typeof names === 'object' && names !== null ? names : {};
    const isKycComplete = (m) => m.sms === 'complete' && m.idDoc === 'complete' && m.account === 'complete';
    const stores = Object.entries(dataObj).map(([id, members]) => {
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
      return {
        id: id || '미지정',
        name: (namesObj[id] !== undefined && namesObj[id] !== '') ? namesObj[id] : (id || '미지정'),
        members: Array.isArray(members) ? members : [],
        usage,
        totalAmount,
        prices: { sms: prices.sms, idDoc: prices.idDoc, account: prices.account, integrated: prices.integrated || 0 },
        suspended: !!suspendedMap[id],
      };
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ stores, prices }),
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
