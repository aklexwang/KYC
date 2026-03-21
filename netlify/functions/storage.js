const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_UPSTASH = UPSTASH_URL && UPSTASH_TOKEN;

const fs = require('fs/promises');
const path = require('path');

// 로컬 테스트 전용: Netlify Blobs 환경설정(siteID/token)이 없을 때만 로컬 JSON 파일로 저장합니다.
// 배포/운영 환경에서는 기본적으로 꺼져 있어야 하므로, 명시적으로 켰을 때만 동작합니다.
const LOCAL_FALLBACK_ENABLED = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.KYC_LOCAL_FALLBACK || '').toLowerCase()
);
const LOCAL_FALLBACK_FILE = process.env.KYC_LOCAL_STORE_FILE
  ? String(process.env.KYC_LOCAL_STORE_FILE)
  : path.resolve(__dirname, '..', '..', '.kyc-local-store.json');

let localFallbackCache = null;
let localFallbackDirty = false;

async function loadLocalFallbackStore() {
  if (localFallbackCache) return localFallbackCache;
  try {
    const raw = await fs.readFile(LOCAL_FALLBACK_FILE, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    localFallbackCache = (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      localFallbackCache = {};
    } else {
      throw err;
    }
  }
  return localFallbackCache;
}

async function persistLocalFallbackStore() {
  if (!localFallbackDirty) return;
  const data = localFallbackCache || {};
  await fs.writeFile(LOCAL_FALLBACK_FILE, JSON.stringify(data, null, 2), 'utf8');
  localFallbackDirty = false;
}

function getLocalFallbackBlobsStore() {
  return {
    async get(key) {
      const store = await loadLocalFallbackStore();
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    async set(key, value) {
      const store = await loadLocalFallbackStore();
      store[key] = value;
      localFallbackDirty = true;
      await persistLocalFallbackStore();
    },
  };
}

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
  try {
    return getStore({ name: 'kyc-data', consistency: 'strong' });
  } catch (err) {
    // 로컬에서 Netlify Blobs 환경값이 없을 때: 로컬 JSON 파일로 대체
    if (LOCAL_FALLBACK_ENABLED && err && err.name === 'MissingBlobsEnvironmentError') {
      console.warn('[KYC] Netlify Blobs 환경값이 없어 로컬 폴백 저장소를 사용합니다:', err.name);
      return getLocalFallbackBlobsStore();
    }
    throw err;
  }
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

async function getStorePointsMap(event) {
  if (USE_UPSTASH) {
    const p = await upstashGet('kyc_store_points');
    return p && typeof p === 'object' ? p : {};
  }
  const store = await blobsGetStore(event);
  const raw = await store.get('store_points');
  if (!raw) return {};
  try {
    const p = JSON.parse(raw);
    return typeof p === 'object' && p !== null ? p : {};
  } catch (e) {
    return {};
  }
}

async function setStorePointsMap(event, map) {
  const obj = typeof map === 'object' && map !== null ? map : {};
  if (USE_UPSTASH) {
    await upstashSet('kyc_store_points', obj);
    return;
  }
  const store = await blobsGetStore(event);
  await store.set('store_points', JSON.stringify(obj));
}

async function deleteStore(event, storeId) {
  if (storeId == null) return;
  let sid = String(storeId).trim();
  // 목록 API가 빈 키를 '미지정'으로만 보여주던 경우와 실제 저장 키 '' 를 맞춤
  if (sid === '미지정') sid = '';
  const keysToPurge = new Set([sid]);
  if (sid === '') keysToPurge.add('미지정');

  const [kycData, passwords, storePrices, counts, suspended, pointsMapRaw] = await Promise.all([
    getKycData(event),
    getStorePasswords(event),
    getStorePrices(event),
    getUsageCounts(event),
    getSuspendedStores(event),
    getStorePointsMap(event).catch(() => ({})),
  ]);
  const pointsMap = typeof pointsMapRaw === 'object' && pointsMapRaw !== null ? { ...pointsMapRaw } : {};
  const data = { ...kycData.data };
  const namesObj = { ...kycData.names };
  const pw = { ...passwords };
  const sp = { ...storePrices };
  const cnt = { ...counts };
  const susp = { ...suspended };
  keysToPurge.forEach(function (k) {
    delete data[k];
    delete namesObj[k];
    delete pw[k];
    delete sp[k];
    delete cnt[k];
    delete susp[k];
    delete pointsMap[k];
  });
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
  await setStorePointsMap(event, pointsMap);
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
  getStorePointsMap,
  setStorePointsMap,
  USE_UPSTASH,
};
