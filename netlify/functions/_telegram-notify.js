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

/** stage: 'sms' | 'idDoc' | 'account' */
function telegramKycLine(stage, memberName) {
  const name = (memberName && String(memberName).trim()) || '이름없음';
  const label =
    stage === 'sms'
      ? '[문자인증 완료]'
      : stage === 'idDoc'
        ? '[신분증인증 완료]'
        : stage === 'account'
          ? '[계좌인증 완료]'
          : '[KYC]';
  return `✅ ${label}\n이름: ${name}`;
}

module.exports = { telegramNotify, telegramKycLine };
