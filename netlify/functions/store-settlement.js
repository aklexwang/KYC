/**
 * 가맹점별 일자·수수료 통계 (본사/가맹점 어드민).
 * 일별 집계는 storage.usage_daily (kyc_usage_daily) — incrementUsage / incrementDailyKycComplete 시 갱신.
 */
const {
  getUsageDaily,
  getStorePrices,
  getUsagePrices,
  getStorageErrorHelp,
} = require('./storage');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const q = event.queryStringParameters || {};
  const store = typeof q.store === 'string' ? q.store.trim() : '';
  if (!store) {
    return json(400, { error: 'store query required' });
  }
  const from = typeof q.from === 'string' ? q.from.trim() : '';
  const to = typeof q.to === 'string' ? q.to.trim() : '';

  try {
    const [dailyMap, globalPrices, storePricesMap] = await Promise.all([
      getUsageDaily(event),
      getUsagePrices(event).catch(() => ({ sms: 100, idDoc: 200, account: 150, integrated: 0 })),
      getStorePrices(event).catch(() => ({})),
    ]);
    const merged = { ...globalPrices, ...(storePricesMap[store] || {}) };
    const smsP = Number(merged.sms) >= 0 ? Number(merged.sms) : 0;
    const idDocP = Number(merged.idDoc) >= 0 ? Number(merged.idDoc) : 0;
    const accountP = Number(merged.account) >= 0 ? Number(merged.account) : 0;
    const integratedP = Number(merged.integrated) >= 0 ? Number(merged.integrated) : 0;

    const byDay = dailyMap[store] && typeof dailyMap[store] === 'object' ? dailyMap[store] : {};
    const fromD = from || '1970-01-01';
    const toD = to || '2099-12-31';

    const rows = [];
    Object.keys(byDay).forEach((dateStr) => {
      if (dateStr < fromD || dateStr > toD) return;
      const c = byDay[dateStr] || {};
      const smsCount = Number(c.sms) || 0;
      const idDocCount = Number(c.idDoc) || 0;
      const wonCount = Number(c.account) || 0;
      const kycComplete = Number(c.kycComplete) || 0;
      if (smsCount + idDocCount + wonCount + kycComplete === 0) return;

      let smsFee;
      let idDocFee;
      let wonFee;
      let total;
      const smsUnit = smsCount > 0 ? smsP : 0;
      const idDocUnit = idDocCount > 0 ? idDocP : 0;
      const wonUnit = wonCount > 0 ? accountP : 0;

      if (integratedP > 0) {
        smsFee = 0;
        idDocFee = 0;
        wonFee = 0;
        total = kycComplete * integratedP;
      } else {
        smsFee = smsCount * smsP;
        idDocFee = idDocCount * idDocP;
        wonFee = wonCount * accountP;
        total = smsFee + idDocFee + wonFee;
      }

      rows.push({
        date: dateStr,
        smsCount,
        smsUnit,
        smsFee,
        idDocCount,
        idDocUnit,
        idDocFee,
        wonCount,
        wonUnit,
        wonFee,
        total,
      });
    });

    rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    return json(200, { ok: true, storeId: store, rows });
  } catch (err) {
    console.error('store-settlement', err);
    const help = getStorageErrorHelp();
    return json(500, { error: 'Storage error', message: (err.message || '') + (help ? '\n\n' + help : '') });
  }
};
