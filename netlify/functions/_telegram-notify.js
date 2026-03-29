/**
 * Netlify 환경 변수: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 * 미설정 시 조용히 무시 (알림 없음).
 * 파일명 _ 접두사: Netlify가 별도 HTTP 함수로 노출하지 않음.
 */

async function telegramNotify(text) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chatId || text == null || text === '') return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: String(text) }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.error('[telegramNotify]', res.status, t.slice(0, 300));
    }
  } catch (e) {
    console.error('[telegramNotify]', e.message || e);
  }
}

/** stage: 'sms' | 'idDoc' | 'account' — phoneOpt: 이름 없을 때 표시용 숫자만 전화 */
function telegramKycLine(stage, memberName, phoneOpt) {
  let name = memberName && String(memberName).trim();
  if (!name) {
    const p = String(phoneOpt || '').replace(/\D/g, '');
    name = p ? `(이름 없음) ${p}` : '이름없음';
  }
  const label =
    stage === 'sms'
      ? '문자(SMS) 인증'
      : stage === 'idDoc'
        ? '신분증·얼굴 인증'
        : stage === 'account'
          ? '계좌(1원) 인증'
          : 'KYC';
  return `✅ [${label}] 완료\n이름: ${name}`;
}

module.exports = { telegramNotify, telegramKycLine };
