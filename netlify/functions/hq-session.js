const crypto = require('crypto');

function getSecret() {
  const s = process.env.HQ_SESSION_SECRET || process.env.HQ_ACCOUNT_VERIFY_SECRET;
  const str = s != null ? String(s) : '';
  return str.length > 0 ? str : null;
}

function createToken(adminId, nickname) {
  const secret = getSecret();
  if (!secret) throw new Error('missing HQ session secret');
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payloadObj = {
    id: String(adminId),
    n: String(nickname || adminId),
    exp,
  };
  const payload = JSON.stringify(payloadObj);
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return Buffer.from(JSON.stringify({ p: payloadObj, s: sig }), 'utf8').toString('base64url');
}

function verifyToken(tokenStr) {
  const secret = getSecret();
  if (!tokenStr || !secret) return null;
  try {
    const outer = JSON.parse(Buffer.from(tokenStr, 'base64url').toString('utf8'));
    if (!outer || !outer.p || !outer.s) return null;
    const payload = JSON.stringify(outer.p);
    const expect = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    if (expect !== outer.s) return null;
    const { id, n, exp } = outer.p;
    if (!exp || Date.now() > exp) return null;
    return { id, nickname: n };
  } catch (e) {
    return null;
  }
}

function verifyHqSessionFromEvent(event) {
  const h = event.headers || {};
  const tok = h['x-hq-admin-token'] || h['X-HQ-Admin-Token'] || '';
  if (!tok) return null;
  return verifyToken(String(tok).trim());
}

module.exports = {
  createToken,
  verifyToken,
  verifyHqSessionFromEvent,
  getSecret,
};
