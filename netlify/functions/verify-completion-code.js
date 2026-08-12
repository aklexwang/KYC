const crypto = require('crypto');
const { getKycData, setKycData, getStorageErrorHelp } = require('./storage');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
};

function json(status, obj) {
  return {
    statusCode: status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('base64url');
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function checkApiKey(event) {
  const expected = String(process.env.COMPLETION_CODE_API_KEY || '').trim();
  if (!expected) return true;
  const headers = event.headers || {};
  const provided = String(headers['x-api-key'] || headers['X-API-Key'] || headers['authorization'] || headers['Authorization'] || '').trim();
  if (!provided) return false;
  if (provided.toLowerCase().startsWith('bearer ')) {
    return provided.slice(7).trim() === expected;
  }
  return provided === expected;
}

async function findCompletionCodeData(event, code) {
  const { data } = await getKycData(event);
  const codeHash = hashCode(code);
  const dataObj = data && typeof data === 'object' ? data : {};
  for (const storeId of Object.keys(dataObj)) {
    const list = Array.isArray(dataObj[storeId]) ? dataObj[storeId] : [];
    for (let idx = 0; idx < list.length; idx += 1) {
      const member = list[idx];
      if (!member || !member.completionCodeHash) continue;
      if (String(member.completionCodeHash) !== codeHash) continue;
      return { data, storeId, list, idx, member };
    }
  }
  return null;
}

async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }
  if (!checkApiKey(event)) {
    return json(401, { error: 'unauthorized' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { error: 'Invalid JSON' });
  }

  const code = String(body.code || '').replace(/\D/g, '').slice(0, 6);
  if (code.length !== 6) {
    return json(400, { valid: false, reason: 'code_required' });
  }

  const phone = body.phone ? normalizePhone(body.phone) : '';

  try {
    const found = await findCompletionCodeData(event, code);
    if (!found) {
      return json(200, { valid: false, reason: 'invalid_code' });
    }

    const { data, storeId, list, idx, member } = found;
    const now = new Date();
    const expiresAt = member.completionCodeExpiresAt ? new Date(member.completionCodeExpiresAt) : null;
    const usedAt = member.completionCodeUsedAt ? new Date(member.completionCodeUsedAt) : null;

    if (phone && normalizePhone(member.phone) && normalizePhone(member.phone) !== phone) {
      return json(200, { valid: false, reason: 'phone_mismatch' });
    }
    if (usedAt && !Number.isNaN(usedAt.getTime())) {
      return json(200, { valid: false, reason: 'already_used' });
    }
    if (!expiresAt || Number.isNaN(expiresAt.getTime()) || now > expiresAt) {
      return json(200, { valid: false, reason: 'expired' });
    }
    if (!member.completionCodeAccountInfo) {
      return json(200, { valid: false, reason: 'account_info_missing' });
    }

    list[idx] = {
      ...member,
      completionCodeUsedAt: now.toISOString(),
    };
    data[storeId] = list;
    await setKycData(event, data, null);

    return json(200, {
      valid: true,
      accountInfo: member.completionCodeAccountInfo,
    });
  } catch (err) {
    console.error('verify-completion-code', err);
    const help = getStorageErrorHelp();
    return json(500, { error: 'Storage error', message: (err.message || '') + (help ? '\n\n' + help : '') });
  }
}

exports.handler = handler;
