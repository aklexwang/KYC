/**
 * Didit Standalone: Passive Liveness → Face Match 1:1 (순차 호출)
 * - https://docs.didit.me/standalone-apis/passive-liveness
 * - https://docs.didit.me/standalone-apis/face-match
 *
 * JSON(base64): selfieImageBase64, idFrontImageBase64
 * Env: DIDIT_API_KEY
 * Optional: DIDIT_PASSIVE_LIVENESS_DECLINE_THRESHOLD (기본 30, 미만이면 거절)
 *           DIDIT_FACE_MATCH_DECLINE_THRESHOLD (기본 70, 미만이면 거절)
 */

const PASSIVE_URL = 'https://verification.didit.me/v3/passive-liveness/';
const FACE_MATCH_URL = 'https://verification.didit.me/v3/face-match/';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, obj) {
  return {
    statusCode: status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}

function parseDataUrlBase64(s) {
  const str = String(s || '');
  const m = str.match(/^data:([^;]+);base64,(.+)$/i);
  if (m) {
    return { mime: m[1].split(';')[0].trim(), buf: Buffer.from(m[2], 'base64') };
  }
  return { mime: 'image/jpeg', buf: Buffer.from(str, 'base64') };
}

function extForMime(mime) {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('tiff')) return 'tiff';
  return 'jpg';
}

function buildMultipart(boundary, parts) {
  const bufs = [];
  for (let i = 0; i < parts.length; i++) {
    bufs.push(Buffer.from(`--${boundary}\r\n`));
    bufs.push(parts[i]);
    bufs.push(Buffer.from('\r\n'));
  }
  bufs.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(bufs);
}

function fieldPart(name, value) {
  const h = `Content-Disposition: form-data; name="${name}"\r\n\r\n${value}`;
  return Buffer.from(h, 'utf8');
}

function filePart(name, filename, contentType, buffer) {
  const h = `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
  return Buffer.concat([Buffer.from(h, 'utf8'), buffer]);
}

async function postMultipart(url, apiKey, parts) {
  const boundary = `didit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const payload = buildMultipart(boundary, parts);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: payload,
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const apiKey = process.env.DIDIT_API_KEY;
  if (!apiKey) {
    return json(503, {
      error: 'not_configured',
      message: 'Set DIDIT_API_KEY in Netlify environment variables.',
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const selfieB64 = body.selfieImageBase64 || body.faceImageBase64;
  const idB64 = body.idFrontImageBase64 || body.idDocumentImageBase64;
  if (!selfieB64 || !idB64) {
    return json(400, { error: 'selfieImageBase64 and idFrontImageBase64 required' });
  }

  let selfie;
  let idFront;
  try {
    selfie = parseDataUrlBase64(selfieB64);
    idFront = parseDataUrlBase64(idB64);
  } catch {
    return json(400, { error: 'Invalid image base64' });
  }

  const minBytes = 512;
  if (!selfie.buf || selfie.buf.length < minBytes || !idFront.buf || idFront.buf.length < minBytes) {
    return json(400, { error: 'image_too_small', message: '이미지 데이터가 너무 작습니다.' });
  }
  const maxBytes = 5 * 1024 * 1024;
  if (selfie.buf.length > maxBytes || idFront.buf.length > maxBytes) {
    return json(400, { error: 'image_too_large', message: '이미지당 최대 5MB입니다.' });
  }

  const liveThresh = String(process.env.DIDIT_PASSIVE_LIVENESS_DECLINE_THRESHOLD || '30').trim() || '30';
  const faceThresh = String(process.env.DIDIT_FACE_MATCH_DECLINE_THRESHOLD || '70').trim() || '70';

  const vendorSlice =
    typeof body.vendorData === 'string' ? body.vendorData.trim().slice(0, 512) : '';

  try {
    const passiveParts = [
      filePart('user_image', `selfie.${extForMime(selfie.mime)}`, selfie.mime || 'image/jpeg', selfie.buf),
      fieldPart('face_liveness_score_decline_threshold', liveThresh),
    ];
    if (vendorSlice) passiveParts.push(fieldPart('vendor_data', vendorSlice));

    const p1 = await postMultipart(PASSIVE_URL, apiKey, passiveParts);
    if (!p1.res.ok) {
      const msg = p1.data.error || p1.data.detail || p1.res.statusText;
      return json(p1.res.status === 403 ? 403 : 502, {
        error: 'didit_error',
        message: typeof msg === 'string' ? msg : JSON.stringify(msg),
        stage: 'liveness',
      });
    }

    const lv = p1.data.liveness;
    const livenessApproved = lv && String(lv.status).toLowerCase() === 'approved';
    const livenessScore = typeof lv?.score === 'number' ? lv.score : null;

    if (!livenessApproved) {
      return json(200, {
        success: false,
        stage: 'liveness',
        livenessScore,
        message: '패시브 라이브니스를 통과하지 못했습니다.',
      });
    }

    const faceParts = [
      filePart('user_image', `selfie.${extForMime(selfie.mime)}`, selfie.mime || 'image/jpeg', selfie.buf),
      filePart(
        'ref_image',
        `id_front.${extForMime(idFront.mime)}`,
        idFront.mime || 'image/jpeg',
        idFront.buf,
      ),
      fieldPart('face_match_score_decline_threshold', faceThresh),
    ];
    if (vendorSlice) faceParts.push(fieldPart('vendor_data', vendorSlice));

    const p2 = await postMultipart(FACE_MATCH_URL, apiKey, faceParts);
    if (!p2.res.ok) {
      const msg = p2.data.error || p2.data.detail || p2.res.statusText;
      return json(p2.res.status === 403 ? 403 : 502, {
        error: 'didit_error',
        message: typeof msg === 'string' ? msg : JSON.stringify(msg),
        stage: 'face_match',
        livenessScore,
      });
    }

    const fm = p2.data.face_match;
    const faceApproved = fm && String(fm.status).toLowerCase() === 'approved';
    const faceScore = typeof fm?.score === 'number' ? fm.score : null;

    return json(200, {
      success: faceApproved,
      stage: faceApproved ? null : 'face_match',
      livenessScore,
      faceScore,
      requestIdLiveness: p1.data.request_id || null,
      requestIdFaceMatch: p2.data.request_id || null,
      message: faceApproved ? null : '얼굴 매칭 점수가 기준에 미달했습니다.',
    });
  } catch (err) {
    console.error('didit-liveness-face', err);
    return json(502, { error: 'upstream', message: err.message || 'Network error' });
  }
};
