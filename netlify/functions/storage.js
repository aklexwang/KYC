const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_UPSTASH = UPSTASH_URL && UPSTASH_TOKEN;

async function upstashGet(key) {
  const res = await fetch(UPSTASH_URL + '/get/' + encodeURIComponent(key), {
    headers: { Authorization: 'Bearer ' + UPSTASH_TOKEN },
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  const raw = json.result;
  if (raw == null) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return raw;
  }
}

async function upstashSet(key, value) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  const res = await fetch(UPSTASH_URL + '/set/' + encodeURIComponent(key), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + UPSTASH_TOKEN, 'Content-Type': 'text/plain' },
    body: body,
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

async function blobsGetStore(event) {
  const { connectLambda, getStore } = require('@netlify/blobs');
  try {
    connectLambda(event);
  } catch (e) {}
  return getStore({ name: 'kyc-data', consistency: 'strong' });
}

const DEFAULT_USAGE_PRICES = { sms: 100, idDoc: 200, account: 150, integrated: 0 };

async function getKycData(event) {
  if (USE_UPSTASH) {
    const [data, names] = await Promise.all([
      upstashGet('kyc_stores'),
      upstashGet('kyc_store_names'),
    ]);
    return {
      data: data && typeof data === 'object' ? data : {},
      names: names && typeof names === 'object' ? names : {},
    };
  }
  const store = await blobsGetStore(event);
  let raw = await store.get('stores');
  let namesRaw = await store.get('store_names');
  let data = {};
  let names = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch (e) {}
  }
  if (namesRaw) {
    try {
      names = JSON.parse(namesRaw);
    } catch (e) {}
  }
  if (typeof data !== 'object' || data === null) data = {};
  if (typeof names !== 'object' || names === null) names = {};
  return { data, names };
}

async function getUsagePrices(event) {
  if (USE_UPSTASH) {
    const prices = await upstashGet('kyc_usage_prices');
    return prices && typeof prices === 'object' ? { ...DEFAULT_USAGE_PRICES, ...prices } : { ...DEFAULT_USAGE_PRICES };
  }
  const store = await blobsGetStore(event);
  const raw = await store.get('usage_prices');
  if (!raw) return { ...DEFAULT_USAGE_PRICES };
  try {
    const p = JSON.parse(raw);
    return { ...DEFAULT_USAGE_PRICES, ...p };
  } catch (e) {
    return { ...DEFAULT_USAGE_PRICES };
  }
}

async function setUsagePrices(event, prices) {
  const p = {
    sms: Number(prices.sms) >= 0 ? Number(prices.sms) : DEFAULT_USAGE_PRICES.sms,
    idDoc: Number(prices.idDoc) >= 0 ? Number(prices.idDoc) : DEFAULT_USAGE_PRICES.idDoc,
    account: Number(prices.account) >= 0 ? Number(prices.account) : DEFAULT_USAGE_PRICES.account,
    integrated: Number(prices.integrated) >= 0 ? Number(prices.integrated) : (DEFAULT_USAGE_PRICES.integrated || 0),
  };
  if (USE_UPSTASH) {
    await upstashSet('kyc_usage_prices', p);
    return;
  }
  const store = await blobsGetStore(event);
  await store.set('usage_prices', JSON.stringify(p));
}

async function getStorePrices(event) {
  if (USE_UPSTASH) {
    const p = await upstashGet('kyc_store_prices');
    return p && typeof p === 'object' ? p : {};
  }
  const store = await blobsGetStore(event);
  const raw = await store.get('store_prices');
  if (!raw) return {};
  try {
    const p = JSON.parse(raw);
    return typeof p === 'object' && p !== null ? p : {};
  } catch (e) {
    return {};
  }
}

async function setStorePrice(event, storeId, prices) {
  const sid = String(storeId).trim();
  if (!sid) return;
  const all = await getStorePrices(event);
  const current = all[sid] || {};
  all[sid] = {
    sms: Number(prices.sms) >= 0 ? Number(prices.sms) : (current.sms ?? DEFAULT_USAGE_PRICES.sms),
    idDoc: Number(prices.idDoc) >= 0 ? Number(prices.idDoc) : (current.idDoc ?? DEFAULT_USAGE_PRICES.idDoc),
    account: Number(prices.account) >= 0 ? Number(prices.account) : (current.account ?? DEFAULT_USAGE_PRICES.account),
    integrated: Number(prices.integrated) >= 0 ? Number(prices.integrated) : (current.integrated ?? (DEFAULT_USAGE_PRICES.integrated || 0)),
  };
  if (USE_UPSTASH) {
    await upstashSet('kyc_store_prices', all);
    return;
  }
  const store = await blobsGetStore(event);
  await store.set('store_prices', JSON.stringify(all));
}

async function getUsageCounts(event) {
  if (USE_UPSTASH) {
    const counts = await upstashGet('kyc_usage_counts');
    return counts && typeof counts === 'object' ? counts : {};
  }
  const store = await blobsGetStore(event);
  const raw = await store.get('usage_counts');
  if (!raw) return {};
  try {
    const c = JSON.parse(raw);
    return typeof c === 'object' && c !== null ? c : {};
  } catch (e) {
    return {};
  }
}

async function setUsageCounts(event, counts) {
  if (USE_UPSTASH) {
    await upstashSet('kyc_usage_counts', counts);
    return;
  }
  const store = await blobsGetStore(event);
  await store.set('usage_counts', JSON.stringify(counts));
}

async function incrementUsage(event, storeId, type) {
  if (!storeId || !['sms', 'idDoc', 'account'].includes(type)) return;
  const counts = await getUsageCounts(event);
  const sid = String(storeId).trim();
  if (!counts[sid]) counts[sid] = { sms: 0, idDoc: 0, account: 0 };
  counts[sid][type] = (counts[sid][type] || 0) + 1;
  await setUsageCounts(event, counts);
}

async function setKycData(event, data, names) {
  const namesToWrite = names != null ? names : (await getKycData(event)).names;
  if (USE_UPSTASH) {
    await upstashSet('kyc_stores', data);
    await upstashSet('kyc_store_names', namesToWrite || {});
    return;
  }
  const store = await blobsGetStore(event);
  await store.set('stores', JSON.stringify(data));
  await store.set('store_names', JSON.stringify(namesToWrite || {}));
}

async function getStorePasswords(event) {
  if (USE_UPSTASH) {
    const p = await upstashGet('kyc_store_passwords');
    return p && typeof p === 'object' ? p : {};
  }
  const store = await blobsGetStore(event);
  const raw = await store.get('store_passwords');
  if (!raw) return {};
  try {
    const p = JSON.parse(raw);
    return typeof p === 'object' && p !== null ? p : {};
  } catch (e) {
    return {};
  }
}

async function setStorePasswords(event, passwords) {
  const obj = typeof passwords === 'object' && passwords !== null ? passwords : {};
  if (USE_UPSTASH) {
    await upstashSet('kyc_store_passwords', obj);
    return;
  }
  const store = await blobsGetStore(event);
  await store.set('store_passwords', JSON.stringify(obj));
}

async function setStorePassword(event, storeId, password) {
  const passwords = await getStorePasswords(event);
  const sid = String(storeId).trim();
  if (!sid) return;
  passwords[sid] = typeof password === 'string' ? password : '';
  await setStorePasswords(event, passwords);
}

async function verifyStorePassword(event, storeId, password) {
  const passwords = await getStorePasswords(event);
  const sid = String(storeId).trim();
  if (!sid || !passwords[sid]) return false;
  return passwords[sid] === (typeof password === 'string' ? password : '');
}

async function getSuspendedStores(event) {
  if (USE_UPSTASH) {
    const p = await upstashGet('kyc_suspended_stores');
    return p && typeof p === 'object' ? p : {};
  }
  const store = await blobsGetStore(event);
  const raw = await store.get('suspended_stores');
  if (!raw) return {};
  try {
    const p = JSON.parse(raw);
    return typeof p === 'object' && p !== null ? p : {};
  } catch (e) {
    return {};
  }
}

async function setStoreSuspended(event, storeId, suspended) {
  const sid = String(storeId).trim();
  if (!sid) return;
  const all = await getSuspendedStores(event);
  if (suspended) all[sid] = true;
  else delete all[sid];
  if (USE_UPSTASH) {
    await upstashSet('kyc_suspended_stores', all);
    return;
  }
  const store = await blobsGetStore(event);
  await store.set('suspended_stores', JSON.stringify(all));
}

async function deleteStore(event, storeId) {
  const sid = String(storeId).trim();
  if (!sid) return;
  const [kycData, passwords, storePrices, counts, suspended] = await Promise.all([
    getKycData(event),
    getStorePasswords(event),
    getStorePrices(event),
    getUsageCounts(event),
    getSuspendedStores(event),
  ]);
  const data = { ...kycData.data };
  const namesObj = { ...kycData.names };
  delete data[sid];
  delete namesObj[sid];
  const pw = { ...passwords };
  delete pw[sid];
  const sp = { ...storePrices };
  delete sp[sid];
  const cnt = { ...counts };
  delete cnt[sid];
  const susp = { ...suspended };
  delete susp[sid];
  await setKycData(event, data, namesObj);
  await setStorePasswords(event, pw);
  if (USE_UPSTASH) {
    await upstashSet('kyc_store_prices', sp);
    await upstashSet('kyc_usage_counts', cnt);
    await upstashSet('kyc_suspended_stores', susp);
  } else {
    const store = await blobsGetStore(event);
    await store.set('store_prices', JSON.stringify(sp));
    await store.set('usage_counts', JSON.stringify(cnt));
    await store.set('suspended_stores', JSON.stringify(susp));
  }
}

function getStorageErrorHelp() {
  if (USE_UPSTASH) return null;
  return '저장소 설정: Netlify Blobs가 이 환경에서 동작하지 않습니다. Upstash(무료) 사용을 권장합니다. 1) https://console.upstash.com 에서 Redis 데이터베이스 생성 2) Netlify 대시보드 → 사이트 설정 → Environment variables 에 UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN 추가 3) 재배포';
}

module.exports = {
  getKycData,
  setKycData,
  getStorageErrorHelp,
  getUsagePrices,
  setUsagePrices,
  getUsageCounts,
  setUsageCounts,
  incrementUsage,
  getStorePrices,
  setStorePrice,
  getStorePasswords,
  setStorePasswords,
  setStorePassword,
  verifyStorePassword,
  getSuspendedStores,
  setStoreSuspended,
  deleteStore,
  USE_UPSTASH,
};
