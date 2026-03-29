/**
 * Didit Standalone ID Verification — POST /v3/id-verification/ (multipart)
 * https://docs.didit.me/standalone-apis/id-verification
 *
 * JSON(base64) 수신 → multipart로 Didit에 전달. 의존성 없음.
 * Env: DIDIT_API_KEY
 */

const DIDIT_ID_URL = 'https://verification.didit.me/v3/id-verification/';
/** Didit 전 단계 검증. 신분증은 단색 배경이라 250KB 미만 JPEG도 흔함 — 기본 80KB, env로 조정 가능 */
const MIN_IMAGE_BYTES = (() => {
  const n = parseInt(process.env.DIDIT_MIN_ID_IMAGE_BYTES || '', 10);
  if (Number.isFinite(n) && n >= 10240 && n <= 512000) return n;
  return 80 * 1024;
})();

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
  if (mime.includes('pdf')) return 'pdf';
  return 'jpg';
}

function sanitizeDiditBody(data) {
  if (!data || typeof data !== 'object') return data;
  const iv = data.id_verification;
  if (!iv || typeof iv !== 'object') return data;
  const copy = { ...data, id_verification: { ...iv } };
  delete copy.id_verification.portrait_image;
  delete copy.id_verification.front_document_image;
  delete copy.id_verification.back_document_image;
  return copy;
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

  const frontB64 = body.frontImageBase64 || body.front_image_base64;
  if (!frontB64) {
    return json(400, { error: 'frontImageBase64 required' });
  }

  let front;
  try {
    front = parseDataUrlBase64(frontB64);
  } catch {
    return json(400, { error: 'Invalid front image base64' });
  }
  if (!front.buf || front.buf.length < MIN_IMAGE_BYTES) {
    return json(400, {
      error: 'image_too_small',
      message:
        '앞면 이미지 용량이 너무 작습니다. 밝은 곳에서 문서 전체가 보이게 촬영하거나, 갤러리에서 원본에 가까운 화질로 선택해 주세요.',
    });
  }
  if (front.buf.length > 5 * 1024 * 1024) {
    return json(400, { error: 'image_too_large', message: '파일당 최대 5MB입니다.' });
  }

  const parts = [
    filePart(
      'front_image',
      `front.${extForMime(front.mime)}`,
      front.mime || 'image/jpeg',
      front.buf,
    ),
  ];

  const backB64 = body.backImageBase64 || body.back_image_base64;
  if (backB64) {
    let back;
    try {
      back = parseDataUrlBase64(backB64);
    } catch {
      return json(400, { error: 'Invalid back image base64' });
    }
    if (!back.buf || back.buf.length < MIN_IMAGE_BYTES) {
      return json(400, {
        error: 'image_too_small',
        message: '뒷면 이미지 용량이 너무 작습니다. 동일하게 선명하게 촬영해 주세요.',
      });
    }
    if (back.buf.length > 5 * 1024 * 1024) {
      return json(400, { error: 'image_too_large' });
    }
    parts.push(
      filePart(
        'back_image',
        `back.${extForMime(back.mime)}`,
        back.mime || 'image/jpeg',
        back.buf,
      ),
    );
  }

  const docLiveness = body.performDocumentLiveness !== false;
  parts.push(fieldPart('perform_document_liveness', docLiveness ? 'true' : 'false'));
  parts.push(fieldPart('preferred_characters', 'non_latin'));

  if (typeof body.vendorData === 'string' && body.vendorData.trim()) {
    parts.push(fieldPart('vendor_data', body.vendorData.trim().slice(0, 512)));
  }

  const boundary = `didit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const payload = buildMultipart(boundary, parts);

  try {
    const res = await fetch(DIDIT_ID_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: payload,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = data.error || data.detail || res.statusText;
      return json(res.status >= 400 && res.status < 500 ? res.status : 502, {
        error: 'didit_error',
        message: typeof msg === 'string' ? msg : JSON.stringify(msg),
        status: res.status,
      });
    }

    const iv = data.id_verification || {};
    const st = String(iv.status || '');
    const approved = /^approved$/i.test(st);

    const sanitized = sanitizeDiditBody(data);
    return json(200, {
      success: approved,
      status: iv.status,
      requestId: data.request_id || null,
      idVerification: sanitized.id_verification || null,
    });
  } catch (err) {
    console.error('didit-id-verification', err);
    return json(502, { error: 'upstream', message: err.message || 'Network error' });
  }
};
